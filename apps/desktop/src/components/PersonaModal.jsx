import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Bot, Code, Cpu, BookOpen, Plus, Check, Trash2 } from 'lucide-react';

export const PRESET_PERSONAS = [
  {
    id: 'general-assistant',
    name: 'Personal Assistant',
    icon: Bot,
    color: '#00f2fe',
    description: 'Balanced, helpful, and concise daily assistant.',
    systemPrompt: 'You are an intelligent, articulate, and highly organized personal AI assistant. Be direct, helpful, clear, and proactive.'
  },
  {
    id: 'tech-architect',
    name: 'Senior Code Architect',
    icon: Code,
    color: '#4facfe',
    description: 'Expert in system architecture, clean code, and refactoring.',
    systemPrompt: 'You are a Principal Software Architect. Provide elegant, production-ready code with concise explanations, clean patterns, and optimal complexity.'
  },
  {
    id: 'ui-ux-pro',
    name: 'UI/UX Design Specialist',
    icon: Sparkles,
    color: '#ff007f',
    description: 'Master of modern design systems, Framer Motion, and micro-interactions.',
    systemPrompt: 'You are an expert UI/UX Designer and Frontend Specialist. Focus on visual hierarchy, glassmorphism, Framer Motion animations, responsive layouts, and user delight.'
  },
  {
    id: 'deep-researcher',
    name: 'Deep Researcher',
    icon: BookOpen,
    color: '#7f00ff',
    description: 'Analytical, thorough, and structured deep dive investigator.',
    systemPrompt: 'You are a Senior Research Analyst. Provide comprehensive, structured breakdowns with bullet points, empirical evidence, step-by-step logic, and clear trade-offs.'
  }
];

export default function PersonaModal({ isOpen, onClose, currentPersona, onSelectPersona, customPersonas = [], onSaveCustomPersona, onDeleteCustomPersona }) {
  const [activeTab, setActiveTab] = useState('presets'); // 'presets' | 'custom'
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);

  const handleCreateCustom = (e) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;

    const newPersona = {
      id: `custom-${Date.now()}`,
      name,
      icon: Cpu,
      color: '#00f2fe',
      description: 'Custom User Assistant Persona',
      systemPrompt,
      temperature
    };

    onSaveCustomPersona(newPersona);
    onSelectPersona(newPersona);
    setName('');
    setSystemPrompt('');
    setTemperature(0.7);
    setActiveTab('presets');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'rgba(5, 8, 14, 0.8)',
        backdropFilter: 'blur(12px)'
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            width: '100%',
            maxWidth: '650px',
            background: 'rgba(15, 21, 35, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '24px',
            padding: '2rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}
        >
          {/* Modal Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(0,242,254,0.2), rgba(127,0,255,0.2))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(0,242,254,0.3)'
              }}>
                <Sparkles size={20} color="#00f2fe" />
              </div>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
                  Custom Assistant Persona
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Customize system instructions & behavior for Ollama
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '0.5rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div style={{
            display: 'flex',
            gap: '0.5rem',
            background: 'rgba(8, 12, 20, 0.6)',
            padding: '4px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.05)'
          }}>
            <button
              onClick={() => setActiveTab('presets')}
              style={{
                flex: 1,
                padding: '0.6rem 1rem',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === 'presets' ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'transparent',
                color: activeTab === 'presets' ? '#000' : '#94a3b8',
                fontWeight: activeTab === 'presets' ? 700 : 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              Preset Assistants
            </button>
            <button
              onClick={() => setActiveTab('custom')}
              style={{
                flex: 1,
                padding: '0.6rem 1rem',
                borderRadius: '10px',
                border: 'none',
                background: activeTab === 'custom' ? 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' : 'transparent',
                color: activeTab === 'custom' ? '#000' : '#94a3b8',
                fontWeight: activeTab === 'custom' ? 700 : 500,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              Build Custom Assistant
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'presets' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                ...PRESET_PERSONAS.map((p) => ({ ...p, isCustom: false })),
                ...customPersonas.map((p) => ({ ...p, isCustom: true }))
              ].map((p) => {
                // Custom personas round-trip through localStorage as JSON,
                // which silently collapses lucide-react's forwardRef icon
                // objects into {} (truthy, so `p.icon || Cpu` wouldn't catch
                // it) — always use a fixed icon for anything persisted.
                const IconComponent = p.isCustom ? Cpu : p.icon;
                const isSelected = currentPersona?.id === p.id;
                return (
                  <motion.div
                    key={p.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      onSelectPersona(p);
                      onClose();
                    }}
                    style={{
                      padding: '1.25rem',
                      borderRadius: '16px',
                      background: isSelected ? 'rgba(0, 242, 254, 0.08)' : 'rgba(20, 27, 45, 0.5)',
                      border: isSelected ? '1px solid #00f2fe' : '1px solid rgba(255, 255, 255, 0.06)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: `${p.color}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: p.color
                      }}>
                        <IconComponent size={20} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isSelected && <Check size={18} color="#00f2fe" />}
                        {p.isCustom && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteCustomPersona?.(p.id);
                            }}
                            title="Delete custom persona"
                            aria-label={`Delete ${p.name}`}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '2px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.95rem' }}>{p.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px', lineHeight: 1.4 }}>
                        {p.description}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <form onSubmit={handleCreateCustom} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                  Assistant Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. My Financial Advisor"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="glass-input"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.95rem'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                  System Instructions (System Prompt)
                </label>
                <textarea
                  rows={4}
                  placeholder="Instruct your assistant on how to think, respond, and format answers..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="glass-input"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.9rem',
                    resize: 'none'
                  }}
                  required
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Creativity (Temperature)</label>
                  <span style={{ fontSize: '0.85rem', color: '#00f2fe', fontWeight: 600 }}>{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#00f2fe' }}
                />
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                style={{
                  marginTop: '0.5rem',
                  padding: '0.85rem',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
              >
                <Plus size={18} />
                Save & Activate Assistant
              </motion.button>
            </form>
          )}
        </motion.div>
      </div>
      )}
    </AnimatePresence>
  );
}
