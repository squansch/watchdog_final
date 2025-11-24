import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Settings,
  Wallet,
  Bell,
  Save,
  RotateCcw,
  History,
  Plus,
  Trash2,
  ScanEye,
  Activity,
  Wifi,
  ExternalLink,
  AlertOctagon,
  Terminal,
  Cpu,
  ShieldAlert,
  Key,
  LayoutDashboard,
  Copy,
  ShoppingCart,
  Coins
} from "lucide-react";

// --- PROJECT CONSTANTS (EDIT THESE) ---
const PROJECT_CONTRACT = "0x539c92285888F572dD5c697B79872580C8B1C8D4";
const BUY_LINK = "https://app.monad.xyz/swap"; // Replace with actual DEX link

// --- TYPES ---

interface BotConfig {
  rpcUrl: string;
  apiKey: string;
  chainId: number;
  explorerUrl: string;
  whaleThreshold: number;
  scanInterval: number;
  telegramToken: string;
  discordWebhook: string;
}

interface ConfigSnapshot {
  id: string;
  timestamp: number;
  config: BotConfig;
  name: string;
}

interface WalletData {
  address: string;
  label: string;
  lastActiveBlock?: number;
  status: "active" | "idle";
}

interface Alert {
  id: string;
  type: "INCOMING" | "OUTGOING" | "WHALE_TX" | "SYSTEM" | "ERROR";
  message: string;
  value: string;
  from: string;
  to: string;
  timestamp: number;
  severity: "low" | "medium" | "high";
  txHash?: string;
  blockNumber?: number;
}

// --- DEFAULT CONFIGURATION ---
const DEFAULT_CONFIG: BotConfig = {
  rpcUrl: "https://rpc.monad.xyz", 
  apiKey: "",
  chainId: 0,
  explorerUrl: "https://monadexplorer.com",
  whaleThreshold: 10,
  scanInterval: 5000, 
  telegramToken: "",
  discordWebhook: ""
};

// --- UTILS: RPC CALLS ---

const formatRpcUrl = (url: string, apiKey: string) => {
  let finalUrl = url.trim();
  if (!finalUrl.startsWith("http")) {
    finalUrl = `https://${finalUrl}`;
  }
  if (apiKey && !finalUrl.includes(apiKey)) {
    const separator = finalUrl.includes("?") ? "&" : "?";
    finalUrl = `${finalUrl}${separator}key=${apiKey}`;
  }
  return finalUrl;
};

const fetchRpc = async (url: string, apiKey: string, method: string, params: any[] = []) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const validUrl = formatRpcUrl(url, apiKey);
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    const res = await fetch(validUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now()
      }),
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  } catch (e: any) {
    throw new Error(e.message || "Network Error");
  }
};

const weiToMon = (hexWei: string): string => {
  if (!hexWei || hexWei === "0x") return "0.00";
  try {
    const val = parseInt(hexWei, 16);
    return (val / 1e18).toFixed(4);
  } catch {
    return "0.00";
  }
};

const shortenAddress = (addr: string) => {
  if (!addr) return "";
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
};

// --- COMPONENTS ---

// 1. Sidebar
const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string; setActiveTab: (t: string) => void }) => {
  const menuItems = [
    { id: "dashboard", icon: LayoutDashboard, label: "Command Center" },
    { id: "settings", icon: Settings, label: "Configuration" },
  ];

  return (
    <div className="w-16 lg:w-20 bg-[#020202] border-r border-[#1F1F1F] flex flex-col h-screen fixed left-0 top-0 z-50 transition-all duration-300">
      <div className="p-4 flex items-center justify-center border-b border-[#1F1F1F]">
        <div className="w-10 h-10 bg-[#836EF9] rounded-md flex items-center justify-center shadow-[0_0_15px_rgba(131,110,249,0.5)]">
          <ScanEye className="text-black w-6 h-6 fill-current" />
        </div>
      </div>

      <nav className="flex-1 py-8 space-y-4 flex flex-col items-center">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 group relative ${
              activeTab === item.id
                ? "bg-[#836EF9] text-black shadow-[0_0_10px_rgba(131,110,249,0.6)]"
                : "text-slate-500 hover:text-slate-200 hover:bg-white/10"
            }`}
          >
            <item.icon size={20} />
            
            {/* Tooltip */}
            <div className="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none font-mono border border-slate-700 shadow-xl">
              {item.label}
            </div>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-[#1F1F1F] flex flex-col items-center gap-4">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse box-shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
      </div>
    </div>
  );
};

// 2. Dashboard View (Combined Alerts + Wallets)
const DashboardView = ({ 
  alerts, 
  clearAlerts, 
  explorerUrl, 
  networkStatus,
  wallets, 
  addWallet, 
  removeWallet
}: { 
  alerts: Alert[]; 
  clearAlerts: () => void; 
  explorerUrl: string; 
  networkStatus: string;
  wallets: WalletData[];
  addWallet: (addr: string, lbl: string) => void;
  removeWallet: (addr: string) => void;
}) => {
  const [newAddress, setNewAddress] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(PROJECT_CONTRACT);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6">
      
      {/* LEFT COLUMN: LIVE FEED */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2 font-mono">
              <Activity className="text-[#836EF9]" size={18} />
              LIVE TX FEED
            </h2>
          </div>
          <button 
            onClick={clearAlerts}
            className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 hover:border-red-500 hover:text-red-400 transition-all text-[10px] text-slate-500 font-mono uppercase tracking-wider"
          >
            Clear Log
          </button>
        </div>

        <div className="glass-panel rounded-xl flex-1 relative overflow-hidden flex flex-col border border-[#1F1F1F] bg-[#050505] min-h-[400px]">
          {/* Terminal Header */}
          <div className="h-8 bg-[#0A0A0A] border-b border-[#1F1F1F] flex items-center px-4 gap-2 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50"></div>
            <div className="ml-auto text-[10px] font-mono text-slate-600">
               {networkStatus === 'online' ? 'CONNECTED' : 'DISCONNECTED'}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm relative custom-scrollbar">
             {/* Scan line effect */}
            <div className="absolute top-0 left-0 w-full h-1 bg-[#836EF9] opacity-10 animate-[scan_3s_ease-in-out_infinite] pointer-events-none z-0"></div>

            {alerts.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-700 select-none">
                <Cpu size={64} className="mb-4 opacity-20" />
                <p className="text-sm font-bold opacity-50">WAITING FOR SIGNALS</p>
                {wallets.length === 0 ? (
                    <p className="text-xs text-[#836EF9] mt-2 animate-pulse">Add a target wallet to start tracking</p>
                ) : (
                    <p className="text-xs text-slate-600 mt-2">Listening for activity on {wallets.length} targets...</p>
                )}
              </div>
            )}
            
            {alerts.map((alert) => (
              <div 
                key={alert.id} 
                className={`relative p-3 border-l-2 transition-all duration-300 hover:bg-white/5 group z-10 animate-fade-in ${
                  alert.type === 'OUTGOING'
                    ? 'border-red-500 bg-red-950/10' 
                    : alert.type === 'INCOMING' 
                      ? 'border-green-500 bg-green-950/10' 
                      : alert.type === 'WHALE_TX'
                        ? 'border-[#836EF9] bg-[#836EF9]/10'
                        : alert.type === 'ERROR'
                          ? 'border-red-700 bg-red-950/20'
                          : 'border-slate-600 bg-slate-900/20'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                  <div className="min-w-[70px]">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                       alert.type === 'OUTGOING' ? 'text-red-400 bg-red-950/30' : 
                       alert.type === 'INCOMING' ? 'text-green-400 bg-green-950/30' :
                       alert.type === 'WHALE_TX' ? 'text-[#836EF9] bg-[#836EF9]/20' :
                       alert.type === 'ERROR' ? 'text-red-500 bg-red-900/20' :
                       'text-slate-400'
                    }`}>
                      {alert.type}
                    </span>
                  </div>

                  <div className="flex-1 flex flex-col md:flex-row md:items-center gap-2">
                     <div className="text-slate-300 text-xs md:text-sm">
                       {alert.message}
                     </div>
                     {alert.value && (
                       <div className="font-bold text-white bg-black/50 px-2 py-0.5 rounded border border-slate-800 text-xs">
                         {alert.value} MON
                       </div>
                     )}
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span className="hidden md:inline">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    
                    {alert.txHash && (
                      <a 
                        href={`${explorerUrl}/tx/${alert.txHash}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[#836EF9] hover:text-white transition-colors flex items-center gap-1"
                      >
                        HASH <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: WALLET MANAGER + TOKEN PROMO */}
      <div className="w-full lg:w-[400px] flex flex-col gap-6 shrink-0">
        
        {/* Token Promo Widget */}
        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#050505] border border-[#333] rounded-xl p-5 shadow-[0_0_20px_rgba(0,0,0,0.5)] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#836EF9] opacity-10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:opacity-20 transition-opacity"></div>
            
            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <h3 className="text-white font-bold font-mono text-sm flex items-center gap-2">
                        <Coins size={14} className="text-[#836EF9]" />
                        WATCHDOG TOKEN
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1">Official Project Utility Token</p>
                </div>
                <a 
                    href={BUY_LINK} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="bg-[#836EF9] hover:bg-[#725ce0] text-black text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition-colors"
                >
                    <ShoppingCart size={12} /> BUY NOW
                </a>
            </div>

            <div className="bg-black/40 border border-[#222] rounded p-2 flex items-center justify-between group/code cursor-pointer relative z-10" onClick={handleCopy}>
                <code className="text-[10px] text-slate-400 font-mono truncate mr-2">
                    {PROJECT_CONTRACT}
                </code>
                <div className={`text-[#836EF9] transition-all ${copyFeedback ? 'scale-110 text-green-400' : ''}`}>
                    {copyFeedback ? <ShieldAlert size={12} /> : <Copy size={12} />}
                </div>
            </div>
        </div>

        {/* Add Wallet Form */}
        <div className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-xl flex flex-col flex-1 min-h-[400px]">
            <div className="p-4 border-b border-[#1F1F1F] bg-[#111]">
                <h3 className="font-bold text-white text-xs font-mono uppercase flex items-center gap-2">
                    <Wallet size={14} /> Target Management
                </h3>
            </div>
            
            <div className="p-4 border-b border-[#1F1F1F]">
                <div className="space-y-3">
                    <div>
                        <input 
                        className="w-full bg-[#050505] border border-slate-800 rounded p-2 text-white font-mono text-xs focus:border-[#836EF9] focus:outline-none placeholder:text-slate-700"
                        value={newAddress}
                        onChange={(e) => setNewAddress(e.target.value)}
                        placeholder="0x Address..."
                        />
                    </div>
                    <div className="flex gap-2">
                        <input 
                        className="flex-1 bg-[#050505] border border-slate-800 rounded p-2 text-white font-mono text-xs focus:border-[#836EF9] focus:outline-none placeholder:text-slate-700"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Label (e.g. Whale)"
                        />
                        <button 
                        onClick={() => {
                            if (newAddress) {
                                addWallet(newAddress, newLabel);
                                setNewAddress("");
                                setNewLabel("");
                            }
                        }}
                        className="bg-[#222] hover:bg-[#836EF9] hover:text-black text-white px-3 rounded border border-slate-800 transition-colors"
                        >
                        <Plus size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Wallet List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {wallets.length === 0 && (
                    <div className="text-center py-8 text-slate-700 font-mono text-[10px]">
                        Add wallets to begin tracking
                    </div>
                )}
                {wallets.map((wallet) => (
                    <div key={wallet.address} className="bg-[#050505] border border-[#1F1F1F] rounded p-3 flex items-center justify-between hover:border-slate-700 transition-all group">
                        <div className="overflow-hidden">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-slate-300 text-xs font-mono truncate">{wallet.label}</h3>
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"></div>
                            </div>
                            <p className="font-mono text-slate-600 text-[10px] truncate">{shortenAddress(wallet.address)}</p>
                        </div>
                        
                        <button 
                        onClick={() => removeWallet(wallet.address)}
                        className="text-slate-700 hover:text-red-500 hover:bg-red-950/20 p-1 rounded transition-colors"
                        >
                        <Trash2 size={12} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </div>
  );
};

// 3. Configuration View (UNCHANGED LOGIC, JUST STYLING MATCH)
const ConfigView = ({ 
  config, 
  setConfig, 
  history, 
  onRestore, 
  onSave,
  networkStatus
}: { 
  config: BotConfig; 
  setConfig: (c: BotConfig) => void; 
  history: ConfigSnapshot[];
  onRestore: (snapshot: ConfigSnapshot) => void;
  onSave: (name: string) => void;
  networkStatus: string;
}) => {
  const [snapshotName, setSnapshotName] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const handleChange = (key: keyof BotConfig, value: any) => {
    setConfig({ ...config, [key]: value });
    setHasChanges(true);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
          <h2 className="text-xl font-bold text-white tracking-tight font-mono">SYSTEM CONFIG</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#0A0A0A] border border-[#1F1F1F] p-8 rounded-xl relative overflow-hidden">
             
            <div className="space-y-8 relative z-10">
              {/* Network Section */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[#836EF9] uppercase tracking-widest flex items-center gap-2 border-b border-[#222] pb-2">
                  <Wifi size={14} /> Network Params
                </h3>
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-2 font-mono uppercase">RPC Endpoint</label>
                    <div className="flex gap-2">
                        <input
                        type="text"
                        value={config.rpcUrl}
                        onChange={(e) => handleChange("rpcUrl", e.target.value)}
                        placeholder="e.g. https://rpc.monad.xyz"
                        className={`flex-1 bg-[#050505] border text-white rounded px-3 py-2 text-xs font-mono focus:outline-none transition-all ${
                            networkStatus === 'online' ? 'border-green-900 focus:border-green-500' : 'border-red-900 focus:border-red-500'
                        }`}
                        />
                        <div className={`flex items-center justify-center px-3 bg-[#111] border border-slate-800 rounded text-[10px] font-mono min-w-[60px] ${
                            networkStatus === 'online' ? 'text-green-500' : 'text-red-500'
                        }`}>
                            {networkStatus === 'online' ? 'LIVE' : 'ERR'}
                        </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-2 font-mono uppercase">API Key (Optional)</label>
                    <div className="flex items-center bg-[#050505] border border-slate-800 rounded px-3">
                        <Key size={14} className="text-slate-600 mr-2" />
                        <input
                        type="password"
                        value={config.apiKey}
                        onChange={(e) => handleChange("apiKey", e.target.value)}
                        placeholder="Paste RPC Provider Key..."
                        className="flex-1 bg-transparent border-none text-white py-2 text-xs font-mono focus:ring-0 focus:outline-none"
                        />
                    </div>
                  </div>
                  {networkStatus === 'offline' && (
                    <div className="bg-red-950/20 border border-red-900/50 p-3 rounded">
                        <p className="text-[10px] text-red-500 font-mono flex items-center gap-2">
                            <ShieldAlert size={10} /> Connection Failed
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1 font-mono">
                            Ensure the RPC URL supports CORS for browser requests. Protocol must be https://.
                        </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Alerts Section */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[#836EF9] uppercase tracking-widest flex items-center gap-2 border-b border-[#222] pb-2">
                   <AlertOctagon size={14} /> Detection Thresholds
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-2 font-mono uppercase">Whale Alert (MON)</label>
                    <input
                      type="number"
                      value={config.whaleThreshold}
                      onChange={(e) => handleChange("whaleThreshold", parseInt(e.target.value))}
                      className="w-full bg-[#050505] border border-slate-800 text-white rounded px-3 py-2 text-xs font-mono focus:border-[#836EF9] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-2 font-mono uppercase">Polling Interval (ms)</label>
                    <input
                      type="number"
                      value={config.scanInterval}
                      onChange={(e) => handleChange("scanInterval", parseInt(e.target.value))}
                      className="w-full bg-[#050505] border border-slate-800 text-white rounded px-3 py-2 text-xs font-mono focus:border-[#836EF9] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Webhooks */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[#836EF9] uppercase tracking-widest flex items-center gap-2 border-b border-[#222] pb-2">
                   <ExternalLink size={14} /> Webhooks
                </h3>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-2 font-mono uppercase">Discord Webhook</label>
                  <input
                    type="password"
                    value={config.discordWebhook}
                    placeholder="https://discord.com/api/webhooks/..."
                    onChange={(e) => handleChange("discordWebhook", e.target.value)}
                    className="w-full bg-[#050505] border border-slate-800 text-white rounded px-3 py-2 text-xs font-mono focus:border-[#836EF9] focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Save Bar */}
            <div className="mt-8 pt-6 border-t border-[#1F1F1F] flex items-center gap-4">
               <input 
                  type="text" 
                  placeholder="Config Name..." 
                  className="bg-[#050505] border border-slate-800 text-white text-xs font-mono rounded px-3 py-2 w-48 focus:border-[#836EF9] focus:outline-none"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
               />
               <button 
                  onClick={() => {
                    onSave(snapshotName || `Auto-Save ${new Date().toLocaleTimeString()}`);
                    setSnapshotName("");
                    setHasChanges(false);
                  }}
                  className="bg-white text-black hover:bg-slate-200 px-4 py-2 rounded text-xs font-bold flex items-center gap-2 transition-colors font-mono uppercase"
               >
                  <Save size={14} />
                  Save State
               </button>
               
               {hasChanges && (
                 <span className="text-[#836EF9] text-[10px] font-mono animate-pulse uppercase ml-auto">
                   [!] Unsaved Changes
                 </span>
               )}
            </div>
          </div>
        </div>

        {/* History Panel */}
        <div className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-xl flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-[#1F1F1F] bg-[#111]">
            <h3 className="font-bold text-white text-xs font-mono uppercase flex items-center gap-2">
                <History size={14} /> Version Control
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
            {history.length === 0 && (
                <div className="text-center py-12 text-slate-700 font-mono text-[10px]">NO BACKUPS</div>
            )}
            {[...history].reverse().map((snapshot) => (
              <div 
                key={snapshot.id} 
                className="group p-3 bg-[#050505] hover:bg-slate-900 border border-slate-800 hover:border-[#836EF9] rounded transition-all cursor-pointer relative"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-bold text-slate-300 text-xs font-mono">{snapshot.name}</span>
                </div>
                <div className="text-[9px] text-slate-600 font-mono">
                  {new Date(snapshot.timestamp).toLocaleString()}
                </div>

                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onRestore(snapshot);
                        }}
                        className="bg-[#836EF9] text-black p-1 rounded hover:bg-[#6d56e8]"
                        title="Rollback"
                    >
                        <RotateCcw size={12} />
                    </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

const App = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [history, setHistory] = useState<ConfigSnapshot[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  
  // Blockchain State
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [lastProcessedBlock, setLastProcessedBlock] = useState<number>(0);
  const [networkStatus, setNetworkStatus] = useState<"online" | "offline">("offline");
  
  // Wallets State
  const [wallets, setWallets] = useState<WalletData[]>([]);

  // 1. Initial Load & History
  useEffect(() => {
    const initialSnapshot: ConfigSnapshot = {
      id: "init-1",
      timestamp: Date.now(),
      config: DEFAULT_CONFIG,
      name: "Default Config"
    };
    setHistory([initialSnapshot]);
  }, []);

  // 2. Scan Logic (Transactions Only)
  const scanBlockchain = useCallback(async () => {
    if (networkStatus !== "online") return;
    
    // NOTE: If no wallets, we still ping the block to show life, but don't scan txs
    if (wallets.length === 0 && blockHeight > 0) return;

    try {
      // 1. Get current block
      const latestBlockHex = await fetchRpc(config.rpcUrl, config.apiKey, "eth_blockNumber", []);
      const latestBlock = parseInt(latestBlockHex, 16);
      
      setBlockHeight(latestBlock);

      // If we haven't scanned before, just set the pointer to current
      if (lastProcessedBlock === 0) {
        setLastProcessedBlock(latestBlock);
        return;
      }

      // Only scan if new blocks exist
      if (latestBlock > lastProcessedBlock) {
        // Iterate through new blocks (limit to last 5 to avoid overloading if lagging)
        const startBlock = Math.max(lastProcessedBlock + 1, latestBlock - 5);
        
        for (let i = startBlock; i <= latestBlock; i++) {
            // Get full block with Transactions
            const blockData = await fetchRpc(config.rpcUrl, config.apiKey, "eth_getBlockByNumber", [`0x${i.toString(16)}`, true]);
            
            if (blockData && blockData.transactions) {
                const txs = blockData.transactions;
                
                // Check all TXs in block
                for (const tx of txs) {
                    const from = tx.from ? tx.from.toLowerCase() : "";
                    const to = tx.to ? tx.to.toLowerCase() : "";
                    const valueMon = weiToMon(tx.value);
                    const isWhale = parseFloat(valueMon) >= config.whaleThreshold;

                    // Match logic
                    const walletMatch = wallets.find(w => 
                        w.address.toLowerCase() === from || w.address.toLowerCase() === to
                    );

                    if (walletMatch) {
                        const type = from === walletMatch.address.toLowerCase() ? "OUTGOING" : "INCOMING";
                        
                        const newAlert: Alert = {
                            id: tx.hash || Date.now().toString(),
                            type: isWhale ? "WHALE_TX" : type,
                            message: `${type === 'OUTGOING' ? 'Sent' : 'Received'} funds ${type === 'OUTGOING' ? 'to' : 'from'} ${shortenAddress(type === 'OUTGOING' ? to : from)}`,
                            value: valueMon,
                            from: tx.from,
                            to: tx.to,
                            timestamp: Date.now(),
                            severity: isWhale ? "high" : "medium",
                            txHash: tx.hash,
                            blockNumber: i
                        };

                        setAlerts(prev => [newAlert, ...prev].slice(0, 50)); // Keep last 50
                    }
                }
            }
        }
        setLastProcessedBlock(latestBlock);
      }
    } catch (e) {
      // console.warn("Scan loop paused due to error", e);
    }
  }, [config.rpcUrl, config.apiKey, wallets, lastProcessedBlock, networkStatus, config.whaleThreshold, blockHeight]);

  // Network Connectivity Check
  useEffect(() => {
    let isMounted = true;
    const checkConn = async () => {
        try {
            const blockHex = await fetchRpc(config.rpcUrl, config.apiKey, "eth_blockNumber", []);
            if (!isMounted) return;
            if (blockHex) {
              setNetworkStatus("online");
              setBlockHeight(parseInt(blockHex, 16));
            }
        } catch(e) {
            if (!isMounted) return;
            setNetworkStatus("offline");
        }
    };
    
    // Initial check
    checkConn();
    const interval = setInterval(checkConn, 10000); // Check connectivity every 10s
    
    return () => {
        isMounted = false;
        clearInterval(interval);
    };
  }, [config.rpcUrl, config.apiKey]);

  // Main Loop
  useEffect(() => {
    const intervalId = setInterval(() => {
      scanBlockchain();
    }, config.scanInterval);

    return () => clearInterval(intervalId);
  }, [config.scanInterval, scanBlockchain]);

  // Actions
  const handleSaveConfig = (name: string) => {
    const snapshot: ConfigSnapshot = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      config: { ...config },
      name
    };
    setHistory(prev => [...prev, snapshot]);
    setAlerts(prev => [{ 
        id: Date.now().toString(), 
        type: "SYSTEM", 
        severity: "low", 
        message: `Config checkpoint saved: ${name}`, 
        timestamp: Date.now(),
        from: "System",
        to: "Local",
        value: ""
    }, ...prev]);
  };

  const handleRestoreConfig = (snapshot: ConfigSnapshot) => {
    setConfig(snapshot.config);
    setAlerts(prev => [{ 
        id: Date.now().toString(), 
        type: "SYSTEM", 
        severity: "medium", 
        message: `Restored: ${snapshot.name}`, 
        timestamp: Date.now(),
        from: "System",
        to: "Local",
        value: ""
    }, ...prev]);
  };

  const addWallet = (address: string, label: string) => {
    if (!address) return;
    setWallets(prev => [...prev, {
      address,
      label: label || `Target ${prev.length + 1}`,
      status: "active"
    }]);
  };

  const removeWallet = (address: string) => {
    setWallets(prev => prev.filter(w => w.address !== address));
  };

  // Render
  return (
    <div className="min-h-screen bg-[#020202] text-slate-50 flex font-sans selection:bg-[#836EF9] selection:text-black">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="ml-16 lg:ml-20 flex-1 p-6 lg:p-8 overflow-y-auto max-h-screen relative">
        {/* Background Gradients */}
        <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-[0%] right-[0%] w-[600px] h-[600px] bg-[#200052] rounded-full mix-blend-screen filter blur-[150px] opacity-20"></div>
          <div className="absolute bottom-[-10%] left-[10%] w-[500px] h-[500px] bg-[#836EF9] rounded-full mix-blend-screen filter blur-[150px] opacity-5"></div>
        </div>

        <header className="relative z-10 flex justify-between items-center mb-8 pb-4 border-b border-[#1F1F1F]">
          <div>
            <div className="flex items-center gap-3">
               <h1 className="text-sm font-bold text-slate-400 uppercase tracking-widest font-mono">
                 WATCHDOG // {activeTab.toUpperCase()}
               </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-3 text-[10px] font-mono border-r border-[#1F1F1F] pr-6">
                 <div className="flex items-center gap-2">
                     <span className="text-slate-500">RPC:</span>
                     <span className={`flex items-center gap-1 ${networkStatus === 'online' ? 'text-green-500' : 'text-red-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${networkStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        {networkStatus.toUpperCase()}
                     </span>
                 </div>
                 <div className="flex items-center gap-2">
                     <span className="text-slate-500">HEIGHT:</span>
                     <span className="text-white">
                         {networkStatus === 'online' ? blockHeight : <span className="text-red-500">CONN_ERR</span>}
                     </span>
                 </div>
             </div>

             <div className="relative group cursor-pointer">
                 <Bell size={18} className={alerts.length > 0 ? "text-white" : "text-slate-600"} />
                 {alerts.length > 0 && (
                   <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#836EF9] rounded-full"></span>
                 )}
             </div>
          </div>
        </header>

        <div className="relative z-10 h-[calc(100vh-140px)]">
          {activeTab === "dashboard" && (
              <DashboardView 
                alerts={alerts} 
                clearAlerts={() => setAlerts([])} 
                explorerUrl={config.explorerUrl}
                networkStatus={networkStatus}
                wallets={wallets}
                addWallet={addWallet}
                removeWallet={removeWallet}
              />
          )}
          {activeTab === "settings" && (
            <ConfigView 
              config={config} 
              setConfig={setConfig} 
              history={history} 
              onRestore={handleRestoreConfig}
              onSave={handleSaveConfig}
              networkStatus={networkStatus}
            />
          )}
        </div>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);