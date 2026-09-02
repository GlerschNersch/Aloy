// In-Chat Message Search Bar
function ChatMessageSearchBar({ isSearching, searchTerm, onSearchChange, onClose }) {
  if (!isSearching) return null;
  return (
    <div style={{ padding: '6px 12px', background: 'rgba(15, 23, 42, 0.95)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>🔍</span>
      <input
        type="text"
        placeholder="Search conversation..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ flex: 1, background: 'transparent', border: 'none', color: '#f8fafc', fontSize: '0.85rem', outline: 'none' }}
      />
      <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
    </div>
  );
}

// Animated Voice Waveform Visualizer for active speech recording
function VoiceWaveformIndicator({ isRecording }) {
  if (!isRecording) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 8px', height: '24px' }}>
      {[0.4, 0.8, 1.2, 0.7, 0.5].map((delay, idx) => (
        <span
          key={idx}
          style={{
            width: '3px',
            height: '14px',
            backgroundColor: '#00f2fe',
            borderRadius: '2px',
            animation: `pulseWave 0.8s ease-in-out infinite alternate`,
            animationDelay: `${delay * 0.2}s`
          }}
        />
      ))}
    </div>
  );
}

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { renderMarkdown } from '../services/markdown';
import {
  Send,
  Paperclip,
  Image as ImageIcon,
  Camera,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
  Brain,
  ChevronDown,
  ChevronUp,
  BookOpen,
  FileText,
  X,
  Power,
  RotateCw,
  Pencil,
  FileType,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  UserCheck,
  UserX,
  Sun,
  AudioWaveform,
  Monitor,
  Terminal,
  Radio,
  Globe,
  Square,
  MoreHorizontal,
  AlertTriangle,
  Search,
  Wrench,
  Zap,
  LayoutDashboard,
  LayoutTemplate,
  Watch
} from 'lucide-react';
import CameraModal from './CameraModal';
import ProjectStatusCard from './ProjectStatusCard';
import WorkspaceOverview from './WorkspaceOverview';
import InteractiveWidget from './InteractiveWidget';
import { parseDocumentFile } from '../services/fileparser';
import { LocalFaceRecognitionEngine } from '../services/facerecognition';
import { checkKokoroStatus, speakKokoroAudio, stopKokoroAudio } from '../services/kokorotts';
import { checkWhisperStatus, transcribeAudio, getPreferredAudioStream, attachSilenceDetector, attachSpeechStartDetector } from '../services/whisperstt';
import { generateAmbientObservation, dispatchAmbientObservation, detectGesture } from '../services/ambientObserver';
import { initSharedWebcam, getSharedWebcamVideo } from '../services/webcamManager';
import { learnMemoryFact, executeOSCommand } from '../services/systemmonitor';
import { getTool } from '../services/tools';


// Hoisted out of ChatArea: it depends only on its `content` argument, and
// MessageRow (module scope) needs it. Being a component-scope closure also meant
// a new function identity every render for no reason.
const renderMessageContent = (content) => {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  let reasoning = null;
  let mainContent = content;

  if (thinkMatch) {
    reasoning = thinkMatch[1].trim();
    mainContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  const actionMatches = [];
  const actionRegex = /\[ACTION:\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*->\s*([a-zA-Z0-9_.]+)\]/g;
  let match;
  while ((match = actionRegex.exec(mainContent)) !== null) {
    actionMatches.push({
      raw: match[0],
      domain: match[1],
      service: match[2],
      entityId: match[3]
    });
  }

  const commandMatches = [];
  const cmdRegex = /\[COMMAND:\s*([\s\S]*?)\]/g;
  let cmdMatch;
  while ((cmdMatch = cmdRegex.exec(mainContent)) !== null) {
    commandMatches.push({
      raw: cmdMatch[0],
      command: cmdMatch[1]
    });
  }

  return { reasoning, mainContent, actionMatches, commandMatches };
};

// Stable identity, always-fresh closure.
//
// React.memo on MessageRow is defeated the moment any prop changes identity
// every render — and four of its handlers are component-scope arrow functions,
// so they do. useCallback would work, but only with a hand-audited dependency
// array on async handlers that close over a lot of state, and a missed
// dependency there is a stale-closure bug that shows up as a stale action
// firing much later. This trades that risk for a ref read: the wrapper is
// created once, and always calls the newest version of the function.
//
// useLayoutEffect, not useEffect, so the ref is current before any user event
// can possibly fire against the newly committed tree.
function useStableCallback(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  // useCallback with an empty dep array rather than reading a ref's .current
  // during render: same stable identity, without the refs-during-render pattern
  // that the React lint rules (correctly) treat as a smell.
  return useCallback((...args) => ref.current(...args), []);
}

// Extracted from an inline messages.map() callback so it can be memoized.
//
// Previously every streamed token re-rendered the ENTIRE history: this 400-line
// subtree was rebuilt for all N messages on every chunk, dozens of times a
// second. The body below is unchanged — every value it closed over is now
// passed as a prop with the same name, so behaviour is identical and only the
// re-render boundary moved.
//
// For memo to actually hold, the props must be referentially stable while a
// reply streams. They are: the state objects here (expandedThinking,
// executedActions, executedCommands, copiedIndex, speakingIndex) only change
// on user interaction, never on a token, and the handlers are wrapped in
// useStableCallback by the parent. Passing a fresh inline arrow for any of
// them would silently defeat this entire component.
const MessageRow = React.memo(function MessageRow({
  msg,
  index,
  expandedThinking,
  setExpandedThinking,
  speakingIndex,
  executedActions,
  handleActionClick,
  executedCommands,
  handleOSCommandClick,
  speakText,
  isKokoroOnline,
  copyToClipboard,
  copiedIndex,
  onToolCallResponse,
  onRegenerate,
  onEditMessage,
  isStreaming
}) {
            const isUser = msg.role === 'user';
            const [isEditing, setIsEditing] = useState(false);
            const [editDraft, setEditDraft] = useState(msg.content);
            // Stable per-message key so AnimatePresence and per-message UI
            // state (reasoning/exec/speaking) don't shift when history changes
            // or the user switches conversations.
            const mkey = msg.timestamp || `idx-${index}`;
            const { reasoning, mainContent, actionMatches, commandMatches } = renderMessageContent(msg.content);
            const isReasoningOpen = expandedThinking[mkey];
            const isSpeaking = speakingIndex === mkey;

            return (
              <motion.div
                key={mkey}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  maxWidth: '850px',
                  width: '100%',
                  margin: '0 auto',
                  flexDirection: isUser ? 'row-reverse' : 'row'
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  background: isUser ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'rgba(127, 0, 255, 0.2)',
                  border: isUser ? 'none' : '1px solid rgba(127, 0, 255, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isUser ? '#000' : '#c084fc',
                  flexShrink: 0
                }}>
                  {isUser ? <User size={20} /> : <Bot size={20} />}
                </div>

                {/* Message Bubble */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start'
                }}>
                  <div className={isUser ? "" : "glass-panel"} style={{
                    padding: '1.1rem 1.4rem',
                    borderRadius: '20px',
                    background: isUser ? 'linear-gradient(135deg, rgba(0, 242, 254, 0.15), rgba(79, 172, 254, 0.15))' : 'rgba(18, 24, 38, 0.8)',
                    border: isUser ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#f8fafc',
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                    maxWidth: '100%',
                    boxShadow: isUser ? '0 4px 20px rgba(0, 242, 254, 0.1)' : 'none'
                  }}>
                    {/* Image Attachment Preview */}
                    {msg.image && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <img
                          src={msg.image}
                          alt="Attachment"
                          style={{ maxWidth: '280px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}
                        />
                      </div>
                    )}

                    {/* File Attachment Pill */}
                    {msg.fileName && (
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '8px',
                        background: 'rgba(0, 242, 254, 0.1)',
                        border: '1px solid rgba(0, 242, 254, 0.3)',
                        fontSize: '0.8rem',
                        color: '#00f2fe',
                        marginBottom: '0.5rem'
                      }}>
                        <FileText size={14} /> {msg.fileName}
                      </div>
                    )}

                    {/* Reasoning Process Drawer */}
                    {reasoning && (
                      <div style={{
                        marginBottom: '1rem',
                        borderRadius: '12px',
                        background: 'rgba(10, 14, 23, 0.6)',
                        border: '1px solid rgba(127, 0, 255, 0.3)',
                        overflow: 'hidden'
                      }}>
                        <button
                          onClick={() => setExpandedThinking(prev => ({ ...prev, [mkey]: !prev[mkey] }))}
                          style={{
                            width: '100%',
                            padding: '0.5rem 0.8rem',
                            background: 'transparent',
                            border: 'none',
                            color: '#c084fc',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Brain size={14} /> Reasoning Process
                          </div>
                          {isReasoningOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {isReasoningOpen && (
                          <div style={{
                            padding: '0.75rem',
                            fontSize: '0.85rem',
                            color: '#94a3b8',
                            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                            fontStyle: 'italic',
                            whiteSpace: 'pre-wrap'
                          }}>
                            {reasoning}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Live Project Status Cards — structured widgets built
                        from real fetched data (see App.jsx), not the
                        model's prose */}
                    {msg.projectStatuses?.map((ps) => (
                      <ProjectStatusCard key={ps.name} name={ps.name} summary={ps.summary} />
                    ))}

                    {/* Tool Calls — read-only tools show a subtle "checked
                        X" chip once resolved; write tools always need
                        explicit Confirm/Deny before they run (see
                        App.jsx#handleToolCallResponse and the "every write
                        needs confirmation" reasoning in services/tools.js) */}
                    {msg.toolCalls?.map((call) => {
                      const tool = getTool(call.name);
                      const readable = call.name.replace(/^get_/, '').replace(/_/g, ' ');

                      if (tool && !tool.requiresConfirmation) {
                        return (
                          <div key={call.id} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: call.status === 'error' ? '#f87171' : '#64748b',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            borderRadius: '20px',
                            padding: '3px 10px',
                            marginBottom: '0.5rem'
                          }}>
                            <Search size={11} />
                            {call.status === 'error' ? `Couldn't check ${readable}` : `Checked ${readable}`}
                          </div>
                        );
                      }

                      const label = tool?.confirmLabel ? tool.confirmLabel(call.arguments) : `Run ${call.name}?`;
                      return (
                        <div key={call.id} className="glass-panel" style={{
                          padding: '0.75rem 1rem',
                          borderRadius: '12px',
                          marginBottom: '0.5rem',
                          maxWidth: '420px',
                          border: call.status === 'pending' ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', color: '#f1f5f9' }}>
                            <Wrench size={14} color="#c084fc" style={{ flexShrink: 0, marginTop: '2px' }} />
                            {/* pre-wrap: a plain span collapses newlines, silently
                                flattening any multi-line confirmLabel (e.g.
                                apollo_curate_document's title + content preview)
                                into one run-on line with no visible separation. */}
                            <span style={{ whiteSpace: 'pre-wrap' }}>{label}</span>
                          </div>
                          {call.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                onClick={() => onToolCallResponse(msg.timestamp, call.id, true)}
                                style={{
                                  flex: 1, padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
                                  border: '1px solid rgba(34, 197, 94, 0.4)', background: 'rgba(34, 197, 94, 0.15)',
                                  color: '#4ade80', fontWeight: 700, fontSize: '0.78rem',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px'
                                }}
                              >
                                <Check size={13} /> Confirm
                              </button>
                              <button
                                onClick={() => onToolCallResponse(msg.timestamp, call.id, false)}
                                style={{
                                  flex: 1, padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
                                  border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.15)',
                                  color: '#f87171', fontWeight: 700, fontSize: '0.78rem',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px'
                                }}
                              >
                                <X size={13} /> Deny
                              </button>
                            </div>
                          ) : (
                            <div style={{
                              fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px',
                              color: call.status === 'done' ? '#4ade80' : call.status === 'denied' ? '#94a3b8' : '#f87171'
                            }}>
                              {call.status === 'done' && <><Check size={13} /> Done</>}
                              {call.status === 'denied' && <><X size={13} /> Declined</>}
                              {call.status === 'error' && <><AlertTriangle size={13} /> Failed</>}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Main Message Content — user messages swap to an
                        editable textarea while isEditing; the rendered
                        markdown body is unchanged for everyone else. */}
                    {isUser && isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <textarea
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (editDraft.trim()) onEditMessage(index, editDraft);
                              setIsEditing(false);
                            } else if (e.key === 'Escape') {
                              setEditDraft(msg.content);
                              setIsEditing(false);
                            }
                          }}
                          style={{
                            width: '100%',
                            minHeight: '4.5em',
                            resize: 'vertical',
                            background: 'rgba(10, 14, 23, 0.6)',
                            border: '1px solid rgba(0, 242, 254, 0.4)',
                            borderRadius: '10px',
                            padding: '0.6rem 0.75rem',
                            color: '#f8fafc',
                            fontSize: '0.95rem',
                            lineHeight: 1.6,
                            fontFamily: 'inherit',
                            outline: 'none'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button
                            type="button"
                            onClick={() => { setEditDraft(msg.content); setIsEditing(false); }}
                            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', borderRadius: '8px', padding: '0.35rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={!editDraft.trim()}
                            onClick={() => { if (editDraft.trim()) { onEditMessage(index, editDraft); setIsEditing(false); } }}
                            style={{
                              background: editDraft.trim() ? '#00f2fe' : 'rgba(0, 242, 254, 0.3)',
                              border: 'none',
                              color: '#001018',
                              fontWeight: 700,
                              borderRadius: '8px',
                              padding: '0.35rem 0.9rem',
                              fontSize: '0.8rem',
                              cursor: editDraft.trim() ? 'pointer' : 'not-allowed'
                            }}
                          >
                            Save &amp; Resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(mainContent) }}
                      />
                    )}

                    {/* Edit action — user messages only, hidden mid-edit and
                        while a turn is in flight (editing would race the
                        in-progress response). */}
                    {isUser && !isEditing && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => { setEditDraft(msg.content); setIsEditing(true); }}
                          disabled={isStreaming}
                          aria-label="Edit message"
                          title="Edit & resend"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#7dd3fc',
                            opacity: isStreaming ? 0.4 : 0.85,
                            cursor: isStreaming ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.72rem',
                            padding: 0
                          }}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                      </div>
                    )}

                    {/* Interactive Micro-Widgets (Sleep Ring, Smart Home Action Bar) */}
                    {!isUser && (
                      <InteractiveWidget
                        text={mainContent}
                        onExecuteHAService={handleActionClick}
                      />
                    )}

                    {msg.answeredViaClaude && (
                      <div style={{
                        marginTop: '0.6rem',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: '#c084fc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <Zap size={12} /> Answered via Claude
                      </div>
                    )}

                    {/* Interactive Home Assistant Action Buttons */}
                    {actionMatches.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginTop: '0.75rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                      }}>
                        <span style={{ fontSize: '0.75rem', color: '#00f2fe', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Interactive Smart Home Trigger
                        </span>
                        {actionMatches.map((act, actIdx) => {
                          const actionKey = `${mkey}-${actIdx}`;
                          const status = executedActions[actionKey];

                          return (
                            <motion.button
                              key={actIdx}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleActionClick(actionKey, act.domain, act.service, act.entityId)}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: '12px',
                                border: 'none',
                                background: status === 'success'
                                  ? 'rgba(34, 197, 94, 0.2)'
                                  : 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                                color: status === 'success' ? '#4ade80' : '#000',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                cursor: 'pointer'
                              }}
                            >
                              {status === 'success' ? (
                                <>
                                  <Check size={16} /> Action Executed! ({act.domain}.{act.service})
                                </>
                              ) : (
                                <>
                                  <Power size={16} /> Execute {act.domain}.{act.service} on {act.entityId}
                                </>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    )}

                    {/* Interactive OS Command Trigger Buttons */}
                    {commandMatches.length > 0 && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginTop: '0.75rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
                      }}>
                        <span style={{ fontSize: '0.75rem', color: '#fde047', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Local OS Command Bridge
                        </span>
                        {commandMatches.map((cmd, cmdIdx) => {
                          const cmdKey = `cmd-${mkey}-${cmdIdx}`;
                          const status = executedCommands[cmdKey];

                          return (
                            <motion.button
                              key={cmdIdx}
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleOSCommandClick(cmdKey, cmd.command)}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: '12px',
                                border: 'none',
                                background: status === 'success'
                                  ? 'rgba(34, 197, 94, 0.2)'
                                  : 'linear-gradient(135deg, #fde047 0%, #eab308 100%)',
                                color: status === 'success' ? '#4ade80' : '#000',
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                cursor: 'pointer'
                              }}
                            >
                              {status === 'success' ? (
                                <>
                                  <Check size={16} /> Command Executed! ({cmd.command})
                                </>
                              ) : (
                                <>
                                  <Terminal size={16} /> Run Command on PC: {cmd.command}
                                </>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    )}

                    {/* Actions: Copy & Studio Voice Read-Aloud */}
                    {!isUser && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '0.75rem',
                        marginTop: '0.5rem',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid rgba(255, 255, 255, 0.05)'
                      }}>
                        {/* Speak Button */}
                        <button
                          onClick={() => speakText(mainContent, mkey)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isSpeaking ? '#c084fc' : '#64748b',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem'
                          }}
                          title="Speak Message with Kokoro Studio Voice"
                        >
                          {isSpeaking ? <VolumeX size={14} color="#c084fc" /> : <Volume2 size={14} />}
                          {isSpeaking ? 'Stop Studio Voice' : (isKokoroOnline ? '🎙️ Kokoro Studio Voice' : 'Speak Out Loud')}
                        </button>

                        {/* Copy Button */}
                        <button
                          onClick={() => copyToClipboard(mainContent, mkey)}
                          aria-label="Copy message"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem'
                          }}
                        >
                          {copiedIndex === mkey ? (
                            <>
                              <Check size={13} color="#4ade80" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy size={13} /> Copy
                            </>
                          )}
                        </button>

                        {/* Regenerate Button — drops this reply and
                            everything after it, then replays the same
                            prior turn. Disabled mid-stream so it can't
                            race an in-progress response. */}
                        <button
                          onClick={() => onRegenerate(index)}
                          disabled={isStreaming}
                          aria-label="Regenerate response"
                          title="Regenerate response"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            cursor: isStreaming ? 'not-allowed' : 'pointer',
                            opacity: isStreaming ? 0.4 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.75rem'
                          }}
                        >
                          <RotateCw size={13} /> Regenerate
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
});

export default function ChatArea({
  messages,
  isStreaming,
  currentStreamContent,
  onSendMessage,
  onRegenerate,
  onEditMessage,
  onStopStreaming,
  isOllamaConnected,
  isPaused,
  currentPersona,
  selectedModel,
  onExecuteHAService,
  isWebSearchEnabled,
  onToggleWebSearch,
  uploadedDocuments,
  onUploadDocument,
  onRemoveDocument,
  vaultDir,
  isSyncingVault,
  vaultSyncStatus,
  onConnectVault,
  onSyncVault,
  onDisconnectVault,
  budgetAlert,
  anomalyAlert,
  onToolCallResponse,
  prefillText,
  onPrefillConsumed,
  memories,
  lastBackupStatus,
  isLockConfigured,
  skillsStats,
  trackedProjects,
  smartHomeStats,
  onOpenMemoryModal,
  onOpenSkillsDashboard,
  onOpenProjectsPanel,
  onOpenSmartHomeDrawer,
  onOpenDevWorkspace,
  onOpenDashboard,
  onTriggerBriefing,
  onToggleCanvas,
  isCanvasOpen,
  onOpenPersonaModal
}) {
  const [input, setInput] = useState('');

  // Lets another part of the app (the Dev Workspace panel's "Ask Aloy"
  // button) drop text into the message box without lifting the whole input
  // state up — App.jsx sets prefillText once, this consumes it into local
  // state and immediately clears it via onPrefillConsumed so it doesn't
  // reapply and stomp on further typing.
  useEffect(() => {
    if (prefillText) {
      setInput(prefillText);
      onPrefillConsumed?.();
    }
  }, [prefillText]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [attachedImage, setAttachedImage] = useState(null);
  const [attachedFile, setAttachedFile] = useState(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState({});
  const [executedActions, setExecutedActions] = useState({});
  const [executedCommands, setExecutedCommands] = useState({});
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Transient inline banner for mic/voice-input failures (offline Whisper,
  // no mic permission, no speech detected, transcription error). These
  // replace what used to be native alert() calls — the one place in this
  // app that broke its own themed, non-blocking error convention (every
  // other failure path renders inline; see runModelTurn's onError in
  // App.jsx). Not pushed into the conversation transcript itself: a failed
  // mic attempt isn't a message either party sent, it's ephemeral UI state.
  const [micNotice, setMicNotice] = useState(null);
  const micNoticeTimerRef = useRef(null);
  const showMicNotice = useCallback((text) => {
    setMicNotice(text);
    if (micNoticeTimerRef.current) clearTimeout(micNoticeTimerRef.current);
    micNoticeTimerRef.current = setTimeout(() => setMicNotice(null), 6000);
  }, []);
  useEffect(() => () => { if (micNoticeTimerRef.current) clearTimeout(micNoticeTimerRef.current); }, []);

  // Voice & Speech Synthesis States
  const [isAutoSpeechEnabled, setIsAutoSpeechEnabled] = useState(true);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [isWhisperOnline, setIsWhisperOnline] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    let t;
    if (isListening) {
      t = setInterval(() => setRecordDuration((p) => p + 1), 1000);
    } else {
      setRecordDuration(0);
    }
    return () => clearInterval(t);
  }, [isListening]);

  const [isKokoroOnline, setIsKokoroOnline] = useState(false);
  const [kokoroVoices, setKokoroVoices] = useState([]);
  const [selectedVoiceID, setSelectedVoiceID] = useState(() => {
    return localStorage.getItem('ollama_pro_kokoro_voice') || 'af_sarah';
  });

  // Feature 1: Walk-Up Proactivity Mode
  const [isWalkUpAutoEnabled, _setIsWalkUpAutoEnabled] = useState(true);
  const todayDateKey = () => new Date().toISOString().slice(0, 10);
  // Tracks the actual calendar date the briefing last fired, in localStorage
  // — sessionStorage (the original approach) gets wiped on every app
  // restart, not just once a day, so a rebuild/relaunch would silently
  // re-arm the trigger and fire "Good morning" again on the next walk-up.
  const [hasTriggeredWalkUpToday, setHasTriggeredWalkUpToday] = useState(() => {
    return localStorage.getItem('ollama_pro_walkup_last_date') === todayDateKey();
  });

  // Feature 2: Hands-Free Wake-Word Activation ("Hey AI")
  const [isWakeWordActive, setIsWakeWordActive] = useState(false);

  // Feature 3: Self-Evolving Memory Notification
  const [learnedMemoryNotice, setLearnedMemoryNotice] = useState(null);

  // Face ML Passive Recognition States
  const [isFaceMLActive, setIsFaceMLActive] = useState(true);
  const [isUserPresent, setIsUserPresent] = useState(true);
  const [recognizedLabel, setRecognizedLabel] = useState('Checking...');
  const faceEngineRef = useRef(new LocalFaceRecognitionEngine());
  const hiddenVideoRef = useRef(null);

  // Webcam Camera Modal State
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  // Header overflow menu (Wake Word / Voice / Face ML — secondary controls)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const wakeWordStreamRef = useRef(null);
  const wakeWordStoppedRef = useRef(true);
  // Kept in sync with isUserPresent so runWakeWordCycle's self-recursive
  // loop (not re-invoked by React re-renders) always reads the latest
  // presence state rather than whatever was closured in when it started.
  const isUserPresentRef = useRef(true);
  const textareaRef = useRef(null);

  useEffect(() => {
    // When Face ML is off there's no reliable presence signal to gate on —
    // default to "present" so wake word behaves exactly as before in that case.
    isUserPresentRef.current = isFaceMLActive ? isUserPresent : true;
  }, [isUserPresent, isFaceMLActive]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleClickOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreMenuOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auto-grow the input textarea up to a cap, then scroll internally.
  const autoGrowTextarea = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  useEffect(() => {
    // Guard against the empty-state landing screen: `messages` is a fresh
    // array reference on every re-render even when still logically empty,
    // so without this the effect refires on every unrelated App.jsx poll
    // (Kokoro/Whisper/HA/etc.) and silently scrolls the always-mounted
    // messagesEndRef anchor into view — invisible when the landing content
    // fit on one screen, but visibly yanks the Workspace Overview cards
    // out of view once there's enough content to actually scroll.
    if (messages.length === 0 && !currentStreamContent) return;
    scrollToBottom();
  }, [messages, currentStreamContent]);

  // Check Kokoro-82M Studio Neural Voice engine status
  useEffect(() => {
    const initKokoro = async () => {
      const status = await checkKokoroStatus();
      setIsKokoroOnline(status.isOnline);
      if (status.isOnline) {
        setKokoroVoices(status.voices);
      }
    };
    initKokoro();
    const interval = setInterval(initKokoro, 10000);
    return () => clearInterval(interval);
  }, []);

  // Check local Whisper (faster-whisper) speech-to-text engine status
  useEffect(() => {
    const initWhisper = async () => setIsWhisperOnline(await checkWhisperStatus());
    initWhisper();
    const interval = setInterval(initWhisper, 10000);
    return () => clearInterval(interval);
  }, []);

  // Feature 1: Continuous Background Webcam & Walk-Up Proactive Greeting Worker
  useEffect(() => {
    let intervalId = null;
    let cancelled = false;
    let prevPresenceState = isUserPresent;
    // Tracks the current continuous-presence streak so "long focus" fires
    // once per sit-down, not once per 8s poll tick once the threshold passes.
    let presenceStreakStart = prevPresenceState ? Date.now() : null;
    let hasFiredLongFocus = false;
    const LONG_FOCUS_THRESHOLD_MS = 60 * 60 * 1000;

    if (isFaceMLActive && !isPaused) {
      initSharedWebcam({ width: 640, height: 480 })
        .then((videoEl) => {
          if (cancelled || !videoEl) return;

          let isChecking = false;
          intervalId = setInterval(async () => {
            if (isChecking) return;
            isChecking = true;
            try {
              const activeVideo = getSharedWebcamVideo() || videoEl;
              const res = await faceEngineRef.current.recognizeFace(activeVideo);
              setIsUserPresent(res.isMatch);
              setRecognizedLabel(res.label);

              if (!prevPresenceState && res.isMatch) {
                // Generate and speak ambient observation on desk arrival
                const now = Date.now();
                const lastArrivalObs = parseInt(localStorage.getItem('ollama_pro_last_arrival_obs') || '0', 10);
                if (now - lastArrivalObs > 15 * 60 * 1000) {
                  localStorage.setItem('ollama_pro_last_arrival_obs', String(now));
                  generateAmbientObservation({
                    videoElement: activeVideo,
                    userName: userProfile?.name || 'User',
                    triggerReason: 'desk_arrival'
                  }).then((obs) => {
                    dispatchAmbientObservation(obs, { speak: isAutoSpeechEnabled, voiceId: selectedVoiceID });
                  }).catch(console.warn);
                }

                if (isWalkUpAutoEnabled && !hasTriggeredWalkUpToday) {
                  localStorage.setItem('ollama_pro_walkup_last_date', todayDateKey());
                  setHasTriggeredWalkUpToday(true);
                  handleTriggerMorningBriefing();
                }
              }

              if (res.isMatch && !prevPresenceState) {
                // Fresh arrival — start a new streak, allow long_focus to fire again this time.
                presenceStreakStart = Date.now();
                hasFiredLongFocus = false;
              } else if (!res.isMatch) {
                presenceStreakStart = null;
                hasFiredLongFocus = false;
              } else if (
                res.isMatch &&
                presenceStreakStart &&
                !hasFiredLongFocus &&
                Date.now() - presenceStreakStart > LONG_FOCUS_THRESHOLD_MS
              ) {
                hasFiredLongFocus = true;
                generateAmbientObservation({
                  videoElement: activeVideo,
                  userName: userProfile?.name || 'User',
                  triggerReason: 'long_focus'
                }).then((obs) => {
                  dispatchAmbientObservation(obs, { speak: isAutoSpeechEnabled, voiceId: selectedVoiceID });
                }).catch(console.warn);
              }

              prevPresenceState = res.isMatch;
            } finally {
              isChecking = false;
            }
          }, 8000);
        })
        .catch(err => {
          console.warn('Background webcam presence access disabled:', err);
          setIsUserPresent(true);
        });
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [isFaceMLActive, isPaused, isWalkUpAutoEnabled, hasTriggeredWalkUpToday]);

  // Push-to-talk voice input, transcribed 100% locally via the faster-whisper
  // server (services/whisperstt.js) rather than the browser's built-in
  // SpeechRecognition, which sends audio to a cloud service and would break
  // this app's local-privacy design.
  const toggleMicListening = async () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    let online = isWhisperOnline;
    if (!online) {
      online = await checkWhisperStatus();
      setIsWhisperOnline(online);
    }

    if (!online) {
      showMicNotice('Local voice transcription (Whisper) is offline. Ensure whisper_server.py is running on port 8890.');
      return;
    }

    try {
      const stream = await getPreferredAudioStream();
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsListening(false);
        setIsTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log('[voice] Sending audio blob size:', blob.size);
          const text = await transcribeAudio(blob);
          console.log('[voice] Received transcription:', text);
          if (text && text.trim().length > 0) {
            const cleanText = text.trim();
            setInput(cleanText);
            // Seamlessly submit voice request directly to Aloy
            setTimeout(() => {
              onSendMessage({ text: cleanText });
              setInput('');
            }, 250);
          } else {
            console.warn('[voice] Transcription returned empty text.');
            showMicNotice('No speech detected. Please speak clearly into your Logitech webcam microphone.');
          }
        } catch (err) {
          console.error('Whisper transcription error:', err);
          showMicNotice(err.message || 'Voice transcription failed.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsListening(true);
    } catch (err) {
      console.error('Microphone access error:', err);
      showMicNotice(`Could not access the microphone: ${err.message}`);
    }
  };

  // Continuous local wake-word listening ("Hey AI"). Records in ~4s cycles
  // (each a self-contained webm file, simpler and more robust than trying to
  // stitch together MediaRecorder's chunked timeslice output) and transcribes
  // each cycle via the same local Whisper server as push-to-talk — no cloud
  // SpeechRecognition involved.
  const runWakeWordCycle = async () => {
    const stream = wakeWordStreamRef.current;
    if (wakeWordStoppedRef.current || !stream) return;

    // Presence-gated: skip the actual record+transcribe cycle while nobody's
    // there (cuts wasted Whisper calls and false triggers from stray noise
    // in an empty room), but keep the loop itself alive so it resumes the
    // moment presence returns — no need to re-toggle wake word manually.
    if (!isUserPresentRef.current) {
      setTimeout(runWakeWordCycle, 4000);
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if (wakeWordStoppedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const text = (await transcribeAudio(blob)).toLowerCase().trim();
      if (text.includes('hey ai') || text.includes('hey assistant') || text.includes('hey ollama')) {
        const cleanCommand = text.replace(/hey ai|hey assistant|hey ollama/g, '').trim();
        if (cleanCommand.length > 3) submitMessageRef.current(cleanCommand);
      }
    } catch (err) {
      console.error('Wake-word transcription error:', err);
    }

    runWakeWordCycle();
  };

  const toggleWakeWordMode = async () => {
    if (isWakeWordActive) {
      wakeWordStoppedRef.current = true; // released once the in-flight ~4s cycle finishes
      setIsWakeWordActive(false);
      return;
    }

    if (!isWhisperOnline) {
      showMicNotice('Local voice transcription (Whisper) is not running. Start whisper_server.py first.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      wakeWordStreamRef.current = stream;
      wakeWordStoppedRef.current = false;
      setIsWakeWordActive(true);
      runWakeWordCycle();
    } catch (err) {
      console.error('Microphone access error:', err);
      showMicNotice('Could not access the microphone.');
    }
  };

  const handleSelectVoice = (voiceId) => {
    setSelectedVoiceID(voiceId);
    localStorage.setItem('ollama_pro_kokoro_voice', voiceId);
  };

  const speakTextImpl = async (text, index = null) => {
    if (speakingIndex === index && index !== null) {
      stopKokoroAudio();
      setSpeakingIndex(null);
      return;
    }

    setSpeakingIndex(index);

    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Code block omitted.')
      .replace(/\[ACTION:[\s\S]*?\]/g, '')
      .replace(/\[COMMAND:[\s\S]*?\]/g, '')
      .replace(/[*_#`~]/g, '');

    if (isKokoroOnline) {
      await speakKokoroAudio(cleanText, selectedVoiceID);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }

    setSpeakingIndex(null);
  };

  const lastSpokenKeyRef = useRef(null);
  useEffect(() => {
    if (!isAutoSpeechEnabled || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return;

    const key = lastMsg.timestamp || `idx-${messages.length - 1}`;
    if (lastSpokenKeyRef.current === key) return;
    lastSpokenKeyRef.current = key;

    // Only speak messages that just arrived — not history re-rendered when the
    // user switches conversations or toggles auto-speak on.
    const ts = Date.parse(lastMsg.timestamp);
    const isFresh = !Number.isNaN(ts) && Date.now() - ts < 5000;
    if (isFresh) {
      // speakTextImpl, not the stable wrapper: the wrapper is declared further
      // down the component body, and although this effect only runs after that
      // line has executed, referencing it here reads as a TDZ hazard and trips
      // the linter. The impl is in scope and identical.
      speakTextImpl(lastMsg.content, key);
    }
  }, [messages, isAutoSpeechEnabled]);

  // Voice barge-in: while Aloy is speaking (speakingIndex set), listen for
  // the user starting to talk over it and cut playback off immediately,
  // rather than making them wait out the whole response. Uses its own
  // dedicated stream with real echoCancellation (unlike getPreferredAudioStream's
  // dictation-tuned webcam-mic path, which deliberately disables it) since
  // this stream runs concurrently with speaker output and needs the browser's
  // own AEC to avoid Aloy's own voice re-triggering itself. Not perfect over
  // open-air speakers — worth a real-world check, most reliable with headphones.
  useEffect(() => {
    if (speakingIndex === null || isListening || isWakeWordActive) return;
    let cancelled = false;
    let stream = null;
    let detach = () => {};

    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then((s) => {
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      detach = attachSpeechStartDetector(stream, () => {
        stopKokoroAudio();
        setSpeakingIndex(null);
      });
    }).catch((err) => {
      console.warn('[barge-in] Could not open monitoring mic:', err);
    });

    return () => {
      cancelled = true;
      detach();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [speakingIndex, isListening, isWakeWordActive]);

  // Gesture confirm/deny: while a tool call is waiting on Confirm/Deny,
  // periodically check the webcam for a thumbs-up (confirm) or a
  // waving/dismissing hand (deny) so a pending action can be resolved
  // without touching the keyboard. There's realistically only ever one
  // open confirmation at a time — the tool-calling loop pauses until it's
  // resolved — so scanning for the single most recent pending call is enough.
  const pendingToolCall = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const call = msg.toolCalls?.find((c) => c.status === 'pending');
      if (call) return { messageTimestamp: msg.timestamp, callId: call.id };
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!pendingToolCall || !isFaceMLActive) return;
    let cancelled = false;
    let timeoutId = null;

    const poll = async () => {
      if (cancelled) return;
      const gesture = await detectGesture({ videoElement: getSharedWebcamVideo() });
      if (cancelled) return;
      if (gesture === 'thumbsup') {
        onToolCallResponse(pendingToolCall.messageTimestamp, pendingToolCall.callId, true);
        return;
      }
      if (gesture === 'wave') {
        onToolCallResponse(pendingToolCall.messageTimestamp, pendingToolCall.callId, false);
        return;
      }
      timeoutId = setTimeout(poll, 3000);
    };
    // Small initial delay — give the confirmation card a moment to render
    // and the user a moment to actually look at the camera before the first check.
    timeoutId = setTimeout(poll, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [pendingToolCall, isFaceMLActive]);

  const handleTriggerMorningBriefing = () => {
    setIsAutoSpeechEnabled(true);
    onSendMessage({
      text: "Good morning! Please give me my Walk-Up Morning Briefing: summarize how I slept last night (sleep score, deep sleep & total duration from my watch), my recovery readiness, my Google Calendar schedule for today and the rest of the week, and report the live status of my smart home lights, security locks, and climate temperature.",
      image: null,
      fileName: null
    });
  };

  const handleInspectScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      stream.getTracks().forEach(t => t.stop());

      setIsAutoSpeechEnabled(true);
      onSendMessage({
        text: "Please analyze my live desktop screen vision snapshot: explain what is visible on my screen, check for any code errors or warnings, and summarize what I am looking at.",
        image: dataUrl,
        fileName: 'Desktop_Screen_Capture.jpg'
      });
    } catch (err) {
      console.warn('Screen capture cancelled or blocked:', err);
    }
  };

  const checkAndLearnMemory = async (userPromptText) => {
    const memoryKeywords = ["remember that", "my favorite", "i prefer", "always use", "remind me that", "my daughter", "my son", "my wife"];
    if (memoryKeywords.some(k => userPromptText.toLowerCase().includes(k))) {
      const res = await learnMemoryFact(userPromptText);
      if (res && res.status === 'success') {
        setLearnedMemoryNotice(`🧠 Self-Evolving Memory Learned: "${userPromptText.slice(0, 40)}..."`);
        setTimeout(() => setLearnedMemoryNotice(null), 5000);
      }
    }
  };

  const submitMessage = (rawText) => {
    const text = (rawText ?? '').trim();
    if ((!text && !attachedImage && !attachedFile) || isStreaming) return;

    checkAndLearnMemory(text);

    // Model-only context: shown to the AI via App's prompt assembly, never
    // baked into the displayed chat bubble (a prior version mutated the
    // text itself here, which meant this tag — and the entire attached
    // file's raw content — rendered inline in the user's message every time).
    const facePresenceContext = isFaceMLActive
      ? (isUserPresent
          ? `[REAL-TIME WEBCAM PRESENCE]: User '${recognizedLabel}' is VERIFIED PRESENT in front of the camera (ML Match).`
          : `[REAL-TIME WEBCAM PRESENCE]: No enrolled user currently detected in front of the camera (User Away).`)
      : null;

    onSendMessage({
      text,
      image: attachedImage?.dataUrl || null,
      fileName: attachedFile?.name || null,
      fileContent: attachedFile?.content || null,
      facePresenceContext,
      // Raw signal (distinct from the formatted facePresenceContext string
      // above) so App.jsx can check WHO was recognized, not just whether
      // face ML is running — used to suppress owner-only behavior (e.g. the
      // daily check-in) when someone other than the enrolled owner is at
      // the keyboard. null when face ML is off, matching facePresenceContext.
      faceIdSignal: isFaceMLActive ? { isUserPresent, recognizedLabel } : null
    });

    setInput('');
    setAttachedImage(null);
    setAttachedFile(null);
    resetTextareaHeight();
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    submitMessage(input);
  };

  // Keep a live reference so the speech-recognition callback (created in a
  // deps-scoped effect) always calls the latest submit logic with fresh state.
  const submitMessageRef = useRef(submitMessage);
  useEffect(() => {
    submitMessageRef.current = submitMessage;
  });

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const copyToClipboardImpl = (text, index) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileType = file.name.split('.').pop().toLowerCase();
    const imageTypes = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'tiff'];

    if (imageTypes.includes(fileType)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachedImage({ name: file.name, dataUrl: event.target.result });
      };
      reader.readAsDataURL(file);
      return;
    }

    setIsParsingFile(true);
    try {
      const parsedText = await parseDocumentFile(file);
      setAttachedFile({ name: file.name, content: parsedText });
      onUploadDocument(file.name, parsedText);
    } catch (err) {
      console.error('File parsing error:', err);
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedImage({ name: file.name, dataUrl: event.target.result });
    };
    reader.readAsDataURL(file);
  };

  const handleCameraSnapshotCapture = (dataUrl) => {
    setAttachedImage({ name: 'Webcam_Snapshot.jpg', dataUrl });
    if (!input.trim()) {
      setInput('Who am I, and what do you see in front of the camera?');
    }
  };

  const handleActionClickImpl = async (actionKey, domain, service, entityId) => {
    // Safety gate: lock/unlock is the one HA domain with real physical-security
    // consequences, and like OS commands it can be suggested by model output
    // shaped by untrusted web-search / document / calendar content. Require
    // explicit confirmation before it runs.
    if (domain === 'lock') {
      const confirmed = window.confirm(
        `${service === 'unlock' ? 'Unlock' : 'Lock'} "${entityId}"?\n\nOnly proceed if you recognize and trust this action.`
      );
      if (!confirmed) return;
    }

    setExecutedActions(prev => ({ ...prev, [actionKey]: 'executing' }));
    const success = await onExecuteHAService(domain, service, entityId);
    if (success) {
      setExecutedActions(prev => ({ ...prev, [actionKey]: 'success' }));
    } else {
      setExecutedActions(prev => ({ ...prev, [actionKey]: 'error' }));
    }
  };

  const handleOSCommandClickImpl = async (cmdKey, commandStr) => {
    // Safety gate: OS commands can originate from model output that was
    // influenced by untrusted web-search / document / calendar content.
    // Never execute without explicit user confirmation of the exact command.
    const confirmed = window.confirm(
      `Run this command on your PC?\n\n${commandStr}\n\nOnly proceed if you recognize and trust this command.`
    );
    if (!confirmed) return;

    setExecutedCommands(prev => ({ ...prev, [cmdKey]: 'executing' }));
    const res = await executeOSCommand(commandStr);
    if (res && res.status === 'completed') {
      setExecutedCommands(prev => ({ ...prev, [cmdKey]: 'success' }));
    } else {
      setExecutedCommands(prev => ({ ...prev, [cmdKey]: 'error' }));
    }
  };


  // Stable identities for everything handed to MessageRow. Without these the
  // memo above never holds: a new arrow function every render counts as a
  // changed prop, so all N rows re-render on every streamed token — exactly the
  // behaviour the extraction was meant to remove. Keep these wrapped.
  const speakText = useStableCallback(speakTextImpl);
  const copyToClipboard = useStableCallback(copyToClipboardImpl);
  const handleActionClick = useStableCallback(handleActionClickImpl);
  const handleOSCommandClick = useStableCallback(handleOSCommandClickImpl);
  const handleRegenerateImpl = (index) => onRegenerate?.(index);
  const handleEditMessageImpl = (index, newText) => onEditMessage?.(index, newText);
  const stableRegenerate = useStableCallback(handleRegenerateImpl);
  const stableEditMessage = useStableCallback(handleEditMessageImpl);

  return (
    <div className="chat-area-container" style={{
      flex: 1,
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'radial-gradient(circle at 50% 0%, rgba(0, 242, 254, 0.05) 0%, transparent 60%)',
      position: 'relative'
    }}>
      {/* Hidden background video worker for passive face ML */}
      <video ref={hiddenVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />

      {/* Sleek Integrated Header Bar */}
      <div className="glass-panel" style={{
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        zIndex: 10
      }}>
        {/* Left: Model & Persona Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            background: '#00f2fe',
            boxShadow: '0 0 10px #00f2fe'
          }} />
          <button
            type="button"
            onClick={onOpenPersonaModal}
            title={onOpenPersonaModal ? 'Switch Active Persona' : undefined}
            aria-label="Switch active persona"
            style={{
              background: 'transparent',
              border: 'none',
              fontWeight: 800,
              fontSize: '0.92rem',
              color: '#f8fafc',
              letterSpacing: '-0.01em',
              cursor: onOpenPersonaModal ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: 0
            }}
          >
            <span>{currentPersona ? currentPersona.name : 'Personal Assistant'}</span>
          </button>
          <span style={{
            fontSize: '0.72rem',
            color: '#00f2fe',
            background: 'rgba(0, 242, 254, 0.08)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 600
          }}>
            {selectedModel}
          </span>
        </div>

        {/* Right Controls: Unified clean topbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Walk-Up Morning Briefing Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleTriggerMorningBriefing}
            title="Trigger Walk-Up Morning Briefing"
            aria-label="Trigger walk-up morning briefing"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 10px',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              color: '#fbbf24',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <Sun size={13} />
            <span>Briefing</span>
          </motion.button>

          {/* Context Canvas Button */}
          {onToggleCanvas && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onToggleCanvas}
              title="Toggle Context Canvas"
              aria-label="Toggle context canvas"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '10px',
                background: isCanvasOpen ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border: isCanvasOpen ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: isCanvasOpen ? '#38bdf8' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <LayoutTemplate size={13} />
              <span>Canvas</span>
            </motion.button>
          )}

          {/* Dashboard Button */}
          {onOpenDashboard && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onOpenDashboard}
              title="Open Dashboard"
              aria-label="Open dashboard"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '10px',
                background: 'rgba(0, 242, 254, 0.08)',
                border: '1px solid rgba(0, 242, 254, 0.25)',
                color: '#00f2fe',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <LayoutDashboard size={13} />
              <span>Dashboard</span>
            </motion.button>
          )}

          {/* In-Chat Message Search Button */}
          <button
            onClick={() => setIsSearching(prev => !prev)}
            title="Search conversation messages"
            aria-label="Search conversation messages"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 9px',
              borderRadius: '10px',
              background: isSearching ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: isSearching ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
              color: isSearching ? '#38bdf8' : '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.78rem'
            }}
          >
            <Search size={13} />
          </button>

          {/* More: all toggles + actions tucked behind one menu */}
          <div ref={moreMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIsMoreMenuOpen(prev => !prev)}
              aria-haspopup="true"
              aria-expanded={isMoreMenuOpen}
              aria-label="More controls: wake word, voice, face presence"
              title="More controls"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                borderRadius: '12px',
                background: isMoreMenuOpen ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: (isWakeWordActive || (isFaceMLActive && !isUserPresent)) ? '#f87171' : '#94a3b8',
                cursor: 'pointer'
              }}
            >
              <MoreHorizontal size={16} />
            </button>

            {isMoreMenuOpen && (
              <div
                className="glass-panel"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  zIndex: 20,
                  minWidth: '240px',
                  padding: '0.5rem',
                  borderRadius: '14px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(12, 17, 28, 0.97)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem'
                }}
              >
                {/* Amazfit Watch Health Glance */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  fontSize: '0.8rem',
                  color: '#34d399',
                  fontWeight: 600
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Watch size={14} color="#34d399" />
                    <span>Amazfit T-Rex 3</span>
                  </div>
                  <span style={{ fontSize: '0.72rem', opacity: 0.9 }}>89pt • 59%</span>
                </div>

                {/* Web Search Toggle */}
                <button
                  onClick={onToggleWebSearch}
                  aria-pressed={isWebSearchEnabled}
                  aria-label={isWebSearchEnabled ? 'Disable web search' : 'Enable web search'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '10px',
                    background: isWebSearchEnabled ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
                    border: 'none',
                    color: isWebSearchEnabled ? '#4ade80' : '#cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Globe size={14} />
                  <span>{isWebSearchEnabled ? 'Web Search: ON' : 'Web Search: OFF'}</span>
                </button>

                {/* Auto-Speech Toggle */}
                <button
                  onClick={() => setIsAutoSpeechEnabled(prev => !prev)}
                  aria-pressed={isAutoSpeechEnabled}
                  aria-label={isAutoSpeechEnabled ? 'Mute auto read-aloud' : 'Enable auto read-aloud'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '10px',
                    background: isAutoSpeechEnabled ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                    border: 'none',
                    color: isAutoSpeechEnabled ? '#c084fc' : '#cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  {isAutoSpeechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{isAutoSpeechEnabled ? 'Auto-Speak: ON' : 'Auto-Speak: OFF'}</span>
                </button>

                {/* Wake Word */}
                <button
                  onClick={toggleWakeWordMode}
                  aria-pressed={isWakeWordActive}
                  aria-label={isWakeWordActive ? 'Disable Hey AI wake word' : 'Enable Hey AI wake word'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '10px',
                    background: isWakeWordActive ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    border: 'none',
                    color: isWakeWordActive ? '#f87171' : '#cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Radio size={14} className={isWakeWordActive ? 'pulse-cyan' : ''} />
                  <span>{isWakeWordActive ? '🎙️ "Hey AI" (Listening)' : 'Wake Word: OFF'}</span>
                </button>

                {/* Kokoro Studio Voice Selector */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 10px',
                  borderRadius: '10px'
                }}>
                  <AudioWaveform size={14} color={isKokoroOnline ? '#c084fc' : '#64748b'} />
                  <select
                    value={selectedVoiceID}
                    onChange={(e) => handleSelectVoice(e.target.value)}
                    style={{
                      flex: 1,
                      fontSize: '0.82rem',
                      padding: '2px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: isKokoroOnline ? '#c084fc' : '#94a3b8',
                      outline: 'none',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                    title="Select Kokoro Studio Voice"
                    aria-label="Select Kokoro Studio voice"
                  >
                    {isKokoroOnline ? (
                      kokoroVoices.map(v => (
                        <option key={v.id} value={v.id} style={{ background: '#171d2c', color: '#fff' }}>
                          {v.name.split(' (')[0]}
                        </option>
                      ))
                    ) : (
                      <option value="af_sarah" style={{ background: '#171d2c', color: '#fff' }}>
                        Sarah (Studio)
                      </option>
                    )}
                  </select>
                </div>

                {/* Real-Time Face Presence Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setIsCameraModalOpen(true)}
                    title="Click to Open Webcam & Enroll Face"
                    aria-label="Open webcam and enroll face"
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 10px',
                      borderRadius: '10px',
                      background: isFaceMLActive
                        ? (isUserPresent ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)')
                        : 'transparent',
                      border: 'none',
                      color: isFaceMLActive
                        ? (isUserPresent ? '#4ade80' : '#f87171')
                        : '#cbd5e1',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    {isUserPresent ? <UserCheck size={14} color="#4ade80" /> : <UserX size={14} color="#f87171" />}
                    <span>{isFaceMLActive ? recognizedLabel : 'Face ML: OFF'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFaceMLActive(prev => !prev)}
                    title={isFaceMLActive ? 'Turn Face ML Off' : 'Turn Face ML On'}
                    aria-label={isFaceMLActive ? 'Turn face ML off' : 'Turn face ML on'}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: isFaceMLActive ? '#00f2fe' : '#64748b',
                      borderRadius: '8px',
                      padding: '4px 6px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {isFaceMLActive ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Obsidian Vault */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    onClick={() => (vaultDir ? onSyncVault() : onConnectVault())}
                    disabled={isSyncingVault}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '7px 10px',
                      borderRadius: '10px',
                      background: vaultDir ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                      border: 'none',
                      color: vaultDir ? '#c084fc' : '#cbd5e1',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: isSyncingVault ? 'default' : 'pointer',
                      textAlign: 'left',
                      opacity: isSyncingVault ? 0.6 : 1
                    }}
                    title={vaultDir ? `Resync vault: ${vaultDir}` : 'Connect an Obsidian vault folder'}
                    aria-label={vaultDir ? 'Resync Obsidian vault' : 'Connect an Obsidian vault folder'}
                  >
                    <BookOpen size={14} />
                    <span>
                      {isSyncingVault
                        ? 'Syncing Vault...'
                        : vaultDir
                          ? `Vault: ${vaultSyncStatus?.count ?? '?'} notes (Resync)`
                          : 'Connect Obsidian Vault'}
                    </span>
                  </button>
                  {vaultDir && (
                    <button
                      onClick={onDisconnectVault}
                      title="Disconnect vault"
                      aria-label="Disconnect vault"
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', margin: '0.2rem 0' }} />

                {/* Inspect Screen (one-shot action) */}
                <button
                  onClick={() => { handleInspectScreen(); setIsMoreMenuOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: '#cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Monitor size={14} color="#c084fc" />
                  <span>Inspect Screen</span>
                </button>

                {/* Morning Briefing (one-shot action) */}
                <button
                  onClick={() => { handleTriggerMorningBriefing(); setIsMoreMenuOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: '#cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  <Sun size={14} color="#00f2fe" />
                  <span>Morning Briefing</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-Chat Message Search Bar */}
      <ChatMessageSearchBar
        isSearching={isSearching}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onClose={() => {
          setIsSearching(false);
          setSearchTerm('');
        }}
      />

      {/* Ollama Offline Banner */}
      {!isOllamaConnected && (
        <div
          role="status"
          style={{
            margin: '0.5rem 1.5rem 0',
            padding: '0.6rem 1rem',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#f87171',
            fontSize: '0.82rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Power size={15} />
          Ollama isn't reachable at localhost:11434. Start the Ollama service, then this will reconnect automatically.
        </div>
      )}

      {/* Feature 3: Self-Evolving Memory Notification Pill */}
      {learnedMemoryNotice && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          style={{
            margin: '0.5rem 1.5rem 0',
            padding: '0.4rem 1rem',
            borderRadius: '10px',
            background: 'rgba(168, 85, 247, 0.2)',
            border: '1px solid rgba(168, 85, 247, 0.5)',
            color: '#c084fc',
            fontSize: '0.8rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Brain size={16} /> {learnedMemoryNotice}
        </motion.div>
      )}

      {/* Budget Alert Banner */}
      {budgetAlert && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          style={{
            margin: '0.5rem 1.5rem 0',
            padding: '0.4rem 1rem',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            color: '#f87171',
            fontSize: '0.8rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertTriangle size={16} /> {budgetAlert}
        </motion.div>
      )}

      {/* Anomaly Alert Banner (spending outliers, unusual lock activity) */}
      {anomalyAlert && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          style={{
            margin: '0.5rem 1.5rem 0',
            padding: '0.4rem 1rem',
            borderRadius: '10px',
            background: 'rgba(192, 132, 252, 0.15)',
            border: '1px solid rgba(192, 132, 252, 0.5)',
            color: '#c084fc',
            fontSize: '0.8rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Sparkles size={16} /> {anomalyAlert}
        </motion.div>
      )}

      {/* Messages Scroll Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.25rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}>
        {messages.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            maxWidth: '850px',
            width: '100%',
            margin: '0 auto',
            textAlign: 'center',
            gap: '1.5rem',
            paddingTop: '2rem'
          }}>
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 22 }}
            >
              <div style={{
                width: '60px',
                height: '60px',
                borderRadius: '22px',
                background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.2), rgba(127, 0, 255, 0.2))',
                border: '1px solid rgba(0, 242, 254, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                boxShadow: '0 0 35px rgba(0, 242, 254, 0.25)'
              }}>
                <Sparkles size={28} color="#00f2fe" />
              </div>

              <h1 style={{ fontSize: '1.9rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em' }}>
                How can <span className="gradient-text">Aloy</span> assist you?
              </h1>
            </motion.div>

            <WorkspaceOverview
              memories={memories}
              lastBackupStatus={lastBackupStatus}
              isLockConfigured={isLockConfigured}
              skillsStats={skillsStats}
              trackedProjects={trackedProjects}
              smartHomeStats={smartHomeStats}
              onOpenMemoryModal={onOpenMemoryModal}
              onOpenSkillsDashboard={onOpenSkillsDashboard}
              onOpenProjectsPanel={onOpenProjectsPanel}
              onOpenSmartHomeDrawer={onOpenSmartHomeDrawer}
              onOpenDevWorkspace={onOpenDevWorkspace}
            />
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg, index) => (
              <MessageRow
                key={msg.timestamp || `idx-${index}`}
                msg={msg}
                index={index}
                expandedThinking={expandedThinking}
                setExpandedThinking={setExpandedThinking}
                speakingIndex={speakingIndex}
                executedActions={executedActions}
                handleActionClick={handleActionClick}
                executedCommands={executedCommands}
                handleOSCommandClick={handleOSCommandClick}
                speakText={speakText}
                isKokoroOnline={isKokoroOnline}
                copyToClipboard={copyToClipboard}
                copiedIndex={copiedIndex}
                onToolCallResponse={onToolCallResponse}
                onRegenerate={stableRegenerate}
                onEditMessage={stableEditMessage}
                isStreaming={isStreaming}
              />
            ))}

            {/* Live Streaming Chunk */}
            {isStreaming && currentStreamContent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  maxWidth: '850px',
                  width: '100%',
                  margin: '0 auto'
                }}
              >
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  background: 'rgba(0, 242, 254, 0.2)',
                  border: '1px solid rgba(0, 242, 254, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#00f2fe',
                  flexShrink: 0
                }}>
                  <Bot size={20} />
                </div>
                <div className="glass-panel" style={{
                  padding: '1.1rem 1.4rem',
                  borderRadius: '20px',
                  color: '#f8fafc',
                  fontSize: '0.95rem',
                  lineHeight: 1.6,
                  flex: 1
                }}>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(currentStreamContent) }} />
                  <span className="pulse-cyan" style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '16px',
                    background: '#00f2fe',
                    marginLeft: '4px',
                    borderRadius: '2px'
                  }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Parsing Indicator */}
      {isParsingFile && (
        <div style={{
          padding: '0.5rem 2rem',
          maxWidth: '850px',
          margin: '0 auto',
          width: '100%',
          color: '#00f2fe',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <FileType size={16} className="spin" /> Parsing document content...
        </div>
      )}

      {/* Attachments Preview Row */}
      {(attachedImage || attachedFile || uploadedDocuments.length > 0) && (
        <div style={{
          padding: '0.5rem 2rem 0',
          maxWidth: '850px',
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap'
        }}>
          {attachedImage && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(0,242,254,0.1)',
              border: '1px solid rgba(0,242,254,0.3)',
              padding: '4px 10px',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#00f2fe'
            }}>
              <ImageIcon size={14} /> {attachedImage.name}
              <button onClick={() => setAttachedImage(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={12} />
              </button>
            </div>
          )}
          {attachedFile && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(127,0,255,0.1)',
              border: '1px solid rgba(127,0,255,0.3)',
              padding: '4px 10px',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#c084fc'
            }}>
              <FileText size={14} /> {attachedFile.name}
              <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={12} />
              </button>
            </div>
          )}
          {/* Vault notes are indexed the same way as uploads but shown as one
              summary pill here — one per note would flood this row for a
              vault of any real size. Individually removable via the more-menu
              vault control (disconnect) instead. */}
          {uploadedDocuments.filter(doc => doc.source !== 'obsidian').map(doc => (
            <div key={doc.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              padding: '4px 10px',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#4ade80'
            }}>
              <BookOpen size={14} /> RAG Document: {doc.filename}
              <button onClick={() => onRemoveDocument(doc.id)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={12} />
              </button>
            </div>
          ))}
          {vaultDir && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(168, 85, 247, 0.1)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              padding: '4px 10px',
              borderRadius: '10px',
              fontSize: '0.8rem',
              color: '#c084fc'
            }}>
              <BookOpen size={14} /> Obsidian Vault: {uploadedDocuments.filter(d => d.source === 'obsidian').length} notes
            </div>
          )}
        </div>
      )}

      {/* Input Form Bar */}
      <div style={{
        padding: '0.75rem 2rem 1.75rem',
        maxWidth: '850px',
        margin: '0 auto',
        width: '100%'
      }}>
        {/* Pantheon Quick Mention Dock */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '8px',
          overflowX: 'auto',
          paddingBottom: '2px'
        }}>
          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>
            Pantheon:
          </span>
          {[
            { tag: '@Aloy', label: 'Core', color: '#00f2fe', bg: 'rgba(0, 242, 254, 0.1)' },
            { tag: '@Hermes', label: 'Briefing', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
            { tag: '@Athena', label: 'Research', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)' },
            { tag: '@Apollo', label: 'Memory', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' },
            { tag: '@Minerva', label: 'Health', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
            { tag: '@Heph', label: 'Dev', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' }
          ].map(persona => (
            <button
              key={persona.tag}
              type="button"
              title={`Click to route prompt directly to ${persona.tag}`}
              onClick={() => {
                setInput(prev => prev.startsWith(persona.tag) ? prev : `${persona.tag} ${prev}`);
                textareaRef.current?.focus();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 9px',
                borderRadius: '12px',
                background: persona.bg,
                border: `1px solid ${persona.color}44`,
                color: persona.color,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = persona.color;
                e.currentTarget.style.boxShadow = `0 0 10px ${persona.color}33`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${persona.color}44`;
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>+</span>
              <span>{persona.tag}</span>
              <span style={{ fontSize: '0.68rem', opacity: 0.75 }}>({persona.label})</span>
            </button>
          ))}
        </div>

        <AnimatePresence>
          {micNotice && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '8px',
                borderRadius: '12px',
                background: 'rgba(248, 113, 113, 0.1)',
                border: '1px solid rgba(248, 113, 113, 0.35)',
                color: '#fca5a5',
                fontSize: '0.82rem'
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{micNotice}</span>
              <button
                type="button"
                onClick={() => setMicNotice(null)}
                aria-label="Dismiss"
                style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', opacity: 0.75, display: 'flex' }}
              >
                <X size={14} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="glass-panel" style={{
          borderRadius: '20px',
          padding: '0.6rem 0.8rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          border: '1px solid rgba(0, 242, 254, 0.25)'
        }}>
          {/* Document File trigger */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach document"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Attach Document (PDF, Word, Excel, PowerPoint, ODT, RTF, EPUB, CSV, TXT, MD, YAML, JSON, Code)"
          >
            <Paperclip size={18} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />

          {/* Image trigger */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            aria-label="Attach image for vision analysis"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Attach Image (Vision Analysis)"
          >
            <ImageIcon size={18} />
          </button>
          <input type="file" ref={imageInputRef} onChange={handleImageUpload} style={{ display: 'none' }} accept="image/*" />

          {/* Webcam Camera Trigger */}
          <button
            type="button"
            onClick={() => setIsCameraModalOpen(true)}
            aria-label="Take webcam vision snapshot and enroll face"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Take Webcam Vision Snapshot & Enroll Face"
          >
            <Camera size={18} />
          </button>

          {/* Microphone Speech Input Trigger (local Whisper transcription) */}
          <button
            type="button"
            onClick={toggleMicListening}
            disabled={isTranscribing}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            aria-pressed={isListening}
            style={{
              background: 'transparent',
              border: 'none',
              color: isListening ? '#ef4444' : isWhisperOnline ? '#94a3b8' : '#4b5563',
              cursor: isTranscribing ? 'default' : 'pointer',
              padding: '0.5rem',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              opacity: isTranscribing ? 0.6 : 1
            }}
            title={
              isTranscribing ? 'Transcribing…'
              : isListening ? 'Listening... Click to stop'
              : isWhisperOnline ? 'Speak to Voice Input (local Whisper)'
              : 'Whisper server offline — start whisper_server.py'
            }
          >
            {isListening ? <MicOff size={18} className="pulse-cyan" /> : <Mic size={18} className={isTranscribing ? 'spin' : ''} />}
          </button>

          {/* Text Area Input */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrowTextarea(e.target);
            }}
            onKeyDown={handleKeyDown}
            aria-label="Message input"
            placeholder={
              isListening
                ? `🎙️ Recording (${recordDuration}s)... speak and click the red mic button to send`
                : isTranscribing
                  ? '⏳ Transcribing your speech with Whisper...'
                  : isWakeWordActive
                    ? 'Listening for "Hey AI"...'
                    : `Ask ${currentPersona?.name || 'Local Ollama'}... (Screen Vision, Voice, Face ML, PDF)`
            }
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#f8fafc',
              fontSize: '0.95rem',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              padding: '0.5rem 0',
              maxHeight: '200px',
              overflowY: 'auto'
            }}
          />

          {/* Send Button */}
          {isStreaming ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={onStopStreaming}
              aria-label="Stop generating"
              title="Stop generating"
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Square size={16} fill="#f87171" />
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() && !attachedImage && !attachedFile}
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                border: 'none',
                background: (input.trim() || attachedImage || attachedFile)
                  ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)'
                  : 'rgba(255, 255, 255, 0.05)',
                color: (input.trim() || attachedImage || attachedFile) ? '#000' : '#64748b',
                cursor: (input.trim() || attachedImage || attachedFile) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: (input.trim() || attachedImage || attachedFile) ? '0 0 15px rgba(0, 242, 254, 0.4)' : 'none'
              }}
            >
              <Send size={18} />
            </motion.button>
          )}
        </form>
      </div>

      <CameraModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={handleCameraSnapshotCapture}
        onEnrollSuccess={(faceData) => {
          // Was setFaceMLResult(...), which is not defined anywhere in this file
          // — so enrolling a face threw a ReferenceError on this line and the
          // two setState calls below it never ran. The enrolled user was never
          // marked present and Face ML was never switched back on, which looks
          // exactly like enrollment silently not working.
          //
          // The old object's only field with a reader was `label`; `isEnrolled`
          // and a hardcoded `confidence: 96` had none. recognizedLabel is the
          // state the presence badge actually renders, and the presence loop
          // sets it alongside setIsUserPresent in the same pairing, so this now
          // matches how recognition reports a match everywhere else.
          if (faceData?.label) setRecognizedLabel(faceData.label);
          setIsUserPresent(true);
          setIsFaceMLActive(true);
        }}
      />
    </div>
  );
}
