import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gamepad2,
  Server,
  Terminal,
  Activity,
  RefreshCw,
  Cpu,
  HardDrive,
  Check,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  Copy,
  ChevronRight,
  Shield,
  Layers,
  Thermometer,
  Monitor
} from 'lucide-react';
import { apiFetch, apiJson } from '../../services/aloyApi.js';

const DEFAULT_MACHINES = [
  { id: 'bazzite', name: 'Bazzite Gaming', host: '192.168.1.111', icon: 'gamepad' },
  { id: 'lenny', name: 'Lenny Server', host: '192.168.1.106', icon: 'server' }
];

export default function BazziteRemoteCard() {
  const [activeMachineId, setActiveMachineId] = useState('bazzite');
  const [machinesData, setMachinesData] = useState({
    bazzite: { id: 'bazzite', name: 'Bazzite Gaming Station', host: '192.168.1.111', online: true },
    lenny: { id: 'lenny', name: 'Lenny Server', host: '192.168.1.106', online: true }
  });
  const [loading, setLoading] = useState(false);
  const [terminalLaunching, setTerminalLaunching] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [commandOutput, setCommandOutput] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showRebootConfirm, setShowRebootConfirm] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  const fetchAllStatus = async () => {
    setLoading(true);
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.remoteGetMachinesStatus) {
        const res = await window.electronAPI.remoteGetMachinesStatus();
        if (res?.statusMap) {
          setMachinesData(res.statusMap);
        }
      } else {
        const res = await apiJson('/api/remote-machines/status');
        if (res.success && res.statusMap) {
          setMachinesData(res.statusMap);
        }
      }
    } catch (err) {
      console.warn('[RemoteMachinesCard] status fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllStatus();
    const interval = setInterval(fetchAllStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const currentStatus = machinesData[activeMachineId] || machinesData.bazzite || {};
  const isOnline = currentStatus?.online ?? false;

  const handleLaunchTerminal = async (targetId = activeMachineId) => {
    setTerminalLaunching(true);
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.remoteLaunchTerminal) {
        await window.electronAPI.remoteLaunchTerminal(targetId);
      } else {
        await apiFetch('/api/remote-machines/launch-terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId: targetId })
        });
      }
    } catch (err) {
      console.error('[RemoteMachinesCard] terminal launch failed:', err);
    } finally {
      setTimeout(() => setTerminalLaunching(false), 1000);
    }
  };

  const handleRunCommand = async (cmdToRun, { elevated = false } = {}) => {
    const cmd = cmdToRun || commandInput;
    if (!cmd || !cmd.trim()) return;

    setExecuting(true);
    setCommandOutput(null);
    try {
      let res;
      if (typeof window !== 'undefined' && window.electronAPI?.remoteExec) {
        res = await window.electronAPI.remoteExec(activeMachineId, cmd.trim(), { elevated });
      } else {
        const fetchRes = await apiFetch('/api/remote-machines/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Only the flag crosses the wire; the server holds the password.
          body: JSON.stringify({ machineId: activeMachineId, command: cmd.trim(), elevated })
        });
        res = await fetchRes.json();
      }

      setCommandOutput({
        machine: activeMachineId,
        command: cmd.trim(),
        timestamp: new Date().toLocaleTimeString(),
        success: res.success,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        exitCode: res.exitCode ?? (res.success ? 0 : 1)
      });
    } catch (err) {
      setCommandOutput({
        machine: activeMachineId,
        command: cmd.trim(),
        timestamp: new Date().toLocaleTimeString(),
        success: false,
        stdout: '',
        stderr: err.message || 'Execution failed',
        exitCode: 1
      });
    } finally {
      setExecuting(false);
    }
  };

  const handleCopyOutput = () => {
    if (!commandOutput) return;
    const text = `${commandOutput.stdout}\n${commandOutput.stderr}`.trim();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReboot = async () => {
    setRebooting(true);
    setShowRebootConfirm(false);
    try {
      // The sudo password used to be inlined here (and at the APT button
      // below). It shipped in the built renderer bundle AND was echoed back
      // into commandOutput.command, which this card renders on screen and
      // copies to the clipboard. The server now injects it from
      // BAZZITE_SUDO_PASS / LENNY_SUDO_PASS when `elevated: true`, so it never
      // crosses into the client at all.
      await handleRunCommand('systemctl reboot', { elevated: true });
      setTimeout(fetchAllStatus, 5000);
    } catch (err) {
      console.error('[RemoteMachinesCard] reboot failed:', err);
    } finally {
      setRebooting(false);
    }
  };

  return (
    <div
      className="glass-panel"
      style={{
        borderRadius: '20px',
        padding: '1.4rem',
        background: 'rgba(15, 21, 35, 0.85)',
        border: isOnline
          ? '1px solid rgba(0, 242, 254, 0.28)'
          : '1px solid rgba(239, 68, 68, 0.3)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}
    >
      {/* Top Header & Machine Selector Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Tab: Bazzite */}
          <button
            onClick={() => setActiveMachineId('bazzite')}
            style={{
              padding: '6px 12px',
              borderRadius: '12px',
              border: activeMachineId === 'bazzite' ? '1px solid rgba(0, 242, 254, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: activeMachineId === 'bazzite' ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: activeMachineId === 'bazzite' ? '#00f2fe' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <Gamepad2 size={14} />
            <span>Bazzite Gaming</span>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: machinesData.bazzite?.online ? '#22c55e' : '#ef4444',
                boxShadow: machinesData.bazzite?.online ? '0 0 6px #22c55e' : 'none'
              }}
            />
          </button>

          {/* Tab: Lenny */}
          <button
            onClick={() => setActiveMachineId('lenny')}
            style={{
              padding: '6px 12px',
              borderRadius: '12px',
              border: activeMachineId === 'lenny' ? '1px solid rgba(192, 132, 252, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: activeMachineId === 'lenny' ? 'rgba(192, 132, 252, 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: activeMachineId === 'lenny' ? '#c084fc' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
          >
            <Server size={14} />
            <span>Lenny Server</span>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: machinesData.lenny?.online ? '#22c55e' : '#ef4444',
                boxShadow: machinesData.lenny?.online ? '0 0 6px #22c55e' : 'none'
              }}
            />
          </button>
        </div>

        {/* Action Buttons: Refresh & Open Terminal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={fetchAllStatus}
            disabled={loading}
            title="Refresh status of all remote machines"
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              borderRadius: '10px',
              padding: '6px 10px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleLaunchTerminal(activeMachineId)}
            disabled={!isOnline || terminalLaunching}
            title={`Launch interactive Windows Terminal SSH session into ${currentStatus?.name || activeMachineId}`}
            style={{
              background: isOnline
                ? activeMachineId === 'lenny'
                  ? 'linear-gradient(135deg, rgba(192, 132, 252, 0.25), rgba(147, 51, 234, 0.25))'
                  : 'linear-gradient(135deg, rgba(0, 242, 254, 0.25), rgba(79, 172, 254, 0.25))'
                : 'rgba(255, 255, 255, 0.05)',
              border: isOnline
                ? activeMachineId === 'lenny'
                  ? '1px solid rgba(192, 132, 252, 0.5)'
                  : '1px solid rgba(0, 242, 254, 0.5)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              color: isOnline ? (activeMachineId === 'lenny' ? '#c084fc' : '#00f2fe') : '#64748b',
              borderRadius: '10px',
              padding: '6px 12px',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: isOnline ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isOnline ? '0 0 15px rgba(0, 242, 254, 0.2)' : 'none'
            }}
          >
            <Terminal size={14} />
            <span>{terminalLaunching ? 'Opening...' : `Open ${activeMachineId === 'lenny' ? 'Lenny' : 'Bazzite'} Terminal`}</span>
          </motion.button>
        </div>
      </div>

      {/* Machine Details Sub-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.2rem 0' }}>
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>
            {currentStatus?.name || (activeMachineId === 'lenny' ? 'Lenny Server' : 'Bazzite Gaming Station')}
          </div>
          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '1px' }}>
            {currentStatus?.hostname || `${activeMachineId}.local`} · {currentStatus?.host} · {currentStatus?.uptime || 'Online'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '12px',
            background: isOnline ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: isOnline ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
            fontSize: '0.72rem',
            fontWeight: 700,
            color: isOnline ? '#4ade80' : '#f87171'
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isOnline ? '#22c55e' : '#ef4444',
              boxShadow: isOnline ? '0 0 6px #22c55e' : 'none'
            }}
          />
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      {/* Telemetry Metric Badges */}
      {isOnline && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.6rem'
          }}
        >
          {/* OS & Version */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>OS / Platform</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {currentStatus?.os || (activeMachineId === 'lenny' ? 'Ubuntu' : 'Bazzite')} {currentStatus?.version ? `v${currentStatus.version.split('.')[0]}` : ''}
            </div>
            <div style={{ fontSize: '0.68rem', color: activeMachineId === 'lenny' ? '#c084fc' : '#00f2fe', marginTop: '1px' }}>
              {currentStatus?.kernel ? currentStatus.kernel.split('-')[0] : 'Linux'}
            </div>
          </div>

          {/* CPU & Temp */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>CPU & Model</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {currentStatus?.cpuTemp || (activeMachineId === 'lenny' ? '6 Cores / 12T' : '48°C')}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentStatus?.cpu ? currentStatus.cpu.replace('Intel(R) Core(TM) ', '') : 'Intel CPU'}
            </div>
          </div>

          {/* RAM Usage */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>Memory (RAM)</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {currentStatus?.ram?.label || '16GB Total'}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#34d399', marginTop: '1px' }}>Nominal</div>
          </div>

          {/* SSD Storage */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>SSD Storage</div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
              {currentStatus?.disk?.avail ? `${currentStatus.disk.avail} Free` : 'SSD Ready'}
            </div>
            <div style={{ fontSize: '0.68rem', color: '#38bdf8', marginTop: '1px' }}>
              {currentStatus?.disk?.percent ? `${currentStatus.disk.percent} used` : 'Available'}
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Chips */}
      {isOnline && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {activeMachineId === 'bazzite' ? (
              <>
                <button
                  onClick={() => handleRunCommand('flatpak update -y && flatpak uninstall --unused -y')}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(0, 242, 254, 0.08)',
                    border: '1px solid rgba(0, 242, 254, 0.25)',
                    color: '#00f2fe',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Sparkles size={12} />
                  <span>Flatpak Maintenance</span>
                </button>
                <button
                  onClick={() => handleRunCommand('rpm-ostree status')}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Image Status
                </button>
                <button
                  onClick={() => handleRunCommand('sensors')}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Sensors
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleRunCommand('apt update', { elevated: true })}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(192, 132, 252, 0.08)',
                    border: '1px solid rgba(192, 132, 252, 0.25)',
                    color: '#c084fc',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Sparkles size={12} />
                  <span>Check APT Updates</span>
                </button>
                <button
                  onClick={() => handleRunCommand('systemctl --failed')}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Service Health
                </button>
                <button
                  onClick={() => handleRunCommand('df -h')}
                  disabled={executing}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Disk Partitions
                </button>
              </>
            )}

            <button
              onClick={() => handleRunCommand('ps aux --sort=-%mem | head -n 6')}
              disabled={executing}
              style={{
                padding: '5px 10px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#e2e8f0',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Top RAM
            </button>

            {/* Reboot Toggle Button */}
            {!showRebootConfirm ? (
              <button
                onClick={() => setShowRebootConfirm(true)}
                disabled={executing || rebooting}
                style={{
                  padding: '5px 10px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <RotateCcw size={12} />
                <span>Reboot</span>
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>Confirm?</span>
                <button
                  onClick={handleReboot}
                  disabled={rebooting}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: '#ef4444',
                    border: 'none',
                    color: '#fff',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {rebooting ? 'Rebooting...' : 'Yes, Restart'}
                </button>
                <button
                  onClick={() => setShowRebootConfirm(false)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    color: '#94a3b8',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* In-App Interactive Command Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunCommand();
            }}
            style={{ display: 'flex', gap: '6px', marginTop: '0.25rem' }}
          >
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder={`Run command on ${currentStatus?.name || activeMachineId} (e.g. uptime, htop, df -h)...`}
              disabled={executing}
              style={{
                flex: 1,
                background: 'rgba(10, 14, 23, 0.65)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '10px',
                padding: '7px 12px',
                color: '#fff',
                fontSize: '0.82rem',
                fontFamily: 'monospace',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={executing || !commandInput.trim()}
              style={{
                background: executing || !commandInput.trim()
                  ? 'rgba(0, 242, 254, 0.1)'
                  : activeMachineId === 'lenny'
                    ? 'rgba(192, 132, 252, 0.25)'
                    : 'rgba(0, 242, 254, 0.25)',
                border: activeMachineId === 'lenny' ? '1px solid rgba(192, 132, 252, 0.4)' : '1px solid rgba(0, 242, 254, 0.4)',
                color: activeMachineId === 'lenny' ? '#c084fc' : '#00f2fe',
                padding: '6px 14px',
                borderRadius: '10px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: executing || !commandInput.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              {executing ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
              <span>{executing ? 'Running' : 'Execute'}</span>
            </button>
          </form>

          {/* Command Output Terminal Viewer */}
          {commandOutput && (
            <div
              style={{
                background: 'rgba(5, 8, 15, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '10px',
                padding: '10px 12px',
                marginTop: '0.4rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontFamily: 'monospace',
                      color: commandOutput.machine === 'lenny' ? '#c084fc' : '#00f2fe',
                      fontWeight: 700
                    }}
                  >
                    [{commandOutput.machine}] $ {commandOutput.command}
                  </span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      background: commandOutput.exitCode === 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: commandOutput.exitCode === 0 ? '#4ade80' : '#f87171',
                      fontWeight: 700
                    }}
                  >
                    exit {commandOutput.exitCode}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.65rem', color: '#64748b' }}>{commandOutput.timestamp}</span>
                  <button
                    type="button"
                    onClick={handleCopyOutput}
                    title={copied ? 'Copied!' : 'Copy Output'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: copied ? '#4ade80' : '#94a3b8',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      fontSize: '0.68rem'
                    }}
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommandOutput(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      fontSize: '0.68rem'
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <pre
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: commandOutput.exitCode === 0 ? '#cbd5e1' : '#fca5a5',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}
              >
                {commandOutput.stdout || commandOutput.stderr || '(No output returned)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
