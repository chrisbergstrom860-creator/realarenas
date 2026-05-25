import { useState, useEffect, useRef } from "react";

/* ─── DATA ─────────────────────────────────────────────────────────── */

const FOLLOWING = [
  { init: "SL", bg: "#FEF9C3", fg: "#854D0E", name: "Sofia L.", sport: "🏃 Running · Coach", streak: "🔥 21d streak · 9,840pts" },
  { init: "YT", bg: "#FCE7F3", fg: "#9D174D", name: "Yuki T.", sport: "🏃 Running · Advanced", streak: "🔥 14d streak · 7,610pts" },
  { init: "AL", bg: "#E0F2FE", fg: "#0369A1", name: "Alena L.", sport: "🏃 Running · Advanced", streak: "🔥 6d streak · 7,220pts" },
  { init: "PR", bg: "#FBEAF0", fg: "#72243E", name: "Priya R.", sport: "🏃 Running · Advanced", streak: "🔥 6d streak · 6,980pts" },
  { init: "TR", bg: "#F5F3FF", fg: "#5B21B6", name: "Tom R.", sport: "🏃 Running · Intermediate", streak: "4d streak · 5,880pts" },
  { init: "MC", bg: "#FEF3C7", fg: "#92400E", name: "Marco C.", sport: "🚴 Cycling · Advanced", streak: "🔥 9d streak" },
];

const FOLLOWERS = [
  { init: "BJ", bg: "#ECFDF5", fg: "#064E3B", name: "Ben J.", sport: "🏃 Running · Beginner", streak: "3d streak · 1,200pts" },
  { init: "KL", bg: "#FFF7ED", fg: "#9A3412", name: "Kate L.", sport: "🚴 Cycling · Intermediate", streak: "🔥 5d streak · 3,440pts" },
  { init: "DM", bg: "#F5F3FF", fg: "#5B21B6", name: "Dev M.", sport: "🧗 Climbing · Advanced", streak: "🔥 12d streak · 6,100pts" },
  { init: "ZH", bg: "#EFF6FF", fg: "#1E40AF", name: "Zoe H.", sport: "🏃 Running · Intermediate", streak: "2d streak · 2,890pts" },
];

const WEEK_DATA = [
  { label: "Mar 24", km: 48, color: "#F97316" },
  { label: "Mar 31", km: 52, color: "#F97316" },
  { label: "Apr 7",  km: 38, color: "#D1D5DB" },
  { label: "Apr 14", km: 64, color: "#F97316" },
  { label: "Apr 21", km: 58, color: "#F97316" },
  { label: "Apr 28", km: 70, color: "#EA580C" },
  { label: "May 5",  km: 57, color: "#F97316" },
  { label: "May 12", km: 12, color: "#FFD21E" },
];
const MAX_KM = 70;

const CAL_TYPES = [
  "rest","light","hard","hard","med","light","rest",
  "hard","light","rest","light","hard","med","rest",
  "hard","hard","med","light","rest","race","light",
  "hard","hard","rest","med","light","hard","today",
];

/* ─── STYLES ────────────────────────────────────────────────────────── */
const CSS = `
@keyframes mp-fade-up { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
@keyframes mp-scale-in { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:none} }

.mp-app { display:grid; grid-template-columns:220px 1fr; grid-template-rows:56px 1fr; min-height:100vh; }

/* TOPBAR */
.mp-topbar { grid-column:1/-1; background:white; border-bottom:1px solid var(--gray-200); display:flex; align-items:center; padding:0 20px 0 0; position:sticky; top:0; z-index:100; }
.mp-topbar-logo { width:220px; padding:0 16px; display:flex; align-items:center; gap:8px; border-right:1px solid var(--gray-200); flex-shrink:0; height:100%; }
.mp-logo-icon { width:28px; height:28px; background:var(--yellow); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:14px; flex-shrink:0; }
.mp-logo-text { font-size:15px; font-weight:600; color:var(--gray-900); }
.mp-topbar-center { flex:1; padding:0 20px; display:flex; align-items:center; }
.mp-search { display:flex; align-items:center; gap:8px; background:var(--gray-50); border:1px solid var(--gray-200); border-radius:7px; padding:6px 12px; width:240px; }
.mp-search input { background:none; border:none; outline:none; font-size:13px; color:var(--gray-700); width:100%; font-family:var(--font); }
.mp-search input::placeholder { color:var(--gray-400); }
.mp-topbar-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
.mp-notif { width:34px; height:34px; border-radius:7px; border:1px solid var(--gray-200); background:white; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:15px; position:relative; }
.mp-notif:hover { background:var(--gray-50); }
.mp-notif-dot { position:absolute; top:6px; right:6px; width:7px; height:7px; border-radius:50%; background:#EF4444; border:1.5px solid white; }
.mp-user-av { width:30px; height:30px; border-radius:50%; background:var(--yellow); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:var(--gray-900); cursor:pointer; }

/* SIDEBAR */
.mp-sidebar { background:white; border-right:1px solid var(--gray-200); display:flex; flex-direction:column; padding:12px 0; position:sticky; top:56px; height:calc(100vh - 56px); overflow-y:auto; }
.mp-sidebar::-webkit-scrollbar { display:none; }
.mp-nav-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--gray-400); padding:10px 16px 4px; }
.mp-nav-item { display:flex; align-items:center; gap:9px; padding:8px 16px; cursor:pointer; font-size:13px; color:var(--gray-600); transition:background .1s,color .1s; position:relative; user-select:none; }
.mp-nav-item:hover { background:var(--gray-50); color:var(--gray-900); }
.mp-nav-item.active { background:#FFF9E0; color:#7a5c00; font-weight:500; }
.mp-nav-item.active::before { content:''; position:absolute; left:0; top:0; bottom:0; width:2px; background:#E6B800; border-radius:0 2px 2px 0; }
.mp-nav-icon { font-size:15px; flex-shrink:0; width:18px; text-align:center; }
.mp-nav-badge { margin-left:auto; font-size:10px; font-family:var(--mono); background:var(--gray-100); color:var(--gray-500); padding:1px 6px; border-radius:10px; }
.mp-nav-badge.red { background:#FEF2F2; color:#EF4444; }
.mp-nav-item.active .mp-nav-badge { background:rgba(255,216,30,0.3); color:#7a5c00; }
.mp-sf { margin-top:auto; padding:12px 16px; border-top:1px solid var(--gray-200); }
.mp-sf-row { display:flex; align-items:center; gap:8px; }
.mp-sf-av { width:30px; height:30px; border-radius:50%; background:var(--yellow); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:var(--gray-900); }

/* MAIN */
.mp-main { overflow-y:auto; }

/* HERO */
.mp-hero { background:#111827; position:relative; overflow:hidden; }
.mp-hero-bg { position:absolute; inset:0; background:linear-gradient(135deg,rgba(255,210,30,.08) 0%,transparent 50%),linear-gradient(225deg,rgba(249,115,22,.05) 0%,transparent 50%); pointer-events:none; }
.mp-hero-grid { position:absolute; inset:0; background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px); background-size:32px 32px; pointer-events:none; }
.mp-hero-inner { max-width:1200px; margin:0 auto; padding:32px 28px; display:flex; align-items:flex-end; gap:24px; position:relative; z-index:1; flex-wrap:wrap; }
.mp-hero-av-wrap { position:relative; flex-shrink:0; }
.mp-hero-av { width:96px; height:96px; border-radius:50%; background:var(--yellow); display:flex; align-items:center; justify-content:center; font-size:32px; font-weight:700; color:var(--gray-900); border:4px solid rgba(255,255,255,.15); cursor:pointer; transition:border-color .2s; }
.mp-hero-av:hover { border-color:var(--yellow); }
.mp-hero-av-edit { position:absolute; bottom:2px; right:2px; width:26px; height:26px; border-radius:50%; background:white; display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; border:2px solid #111827; opacity:0; transition:opacity .2s; }
.mp-hero-av-wrap:hover .mp-hero-av-edit { opacity:1; }
.mp-hero-online { position:absolute; top:6px; right:6px; width:14px; height:14px; border-radius:50%; background:#10B981; border:2.5px solid #111827; }
.mp-hero-info { flex:1; min-width:220px; }
.mp-hero-name { font-size:26px; font-weight:700; color:white; letter-spacing:-.02em; margin-bottom:3px; animation:mp-fade-up .3s ease .1s both; }
.mp-hero-handle { font-size:13px; color:#9CA3AF; font-family:var(--mono); margin-bottom:10px; animation:mp-fade-up .3s ease .15s both; }
.mp-hero-tags { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; animation:mp-fade-up .3s ease .2s both; }
.mp-hero-tag { padding:3px 10px; border-radius:20px; font-size:11px; font-weight:500; background:rgba(255,255,255,.1); color:rgba(255,255,255,.8); border:1px solid rgba(255,255,255,.15); display:flex; align-items:center; gap:4px; }
.mp-tag-run { background:rgba(249,115,22,.2); color:#FDBA74; border-color:rgba(249,115,22,.3); }
.mp-tag-cyc { background:rgba(59,130,246,.2); color:#93C5FD; border-color:rgba(59,130,246,.3); }
.mp-tag-clm { background:rgba(139,92,246,.2); color:#C4B5FD; border-color:rgba(139,92,246,.3); }
.mp-tag-adv { background:rgba(16,185,129,.15); color:#6EE7B7; border-color:rgba(16,185,129,.25); }
.mp-hero-bio { font-size:13px; color:#9CA3AF; line-height:1.6; max-width:480px; animation:mp-fade-up .3s ease .22s both; }
.mp-hero-stats { display:flex; gap:28px; animation:mp-fade-up .3s ease .25s both; flex-shrink:0; }
.mp-hs { text-align:center; }
.mp-hs-val { font-size:20px; font-weight:700; color:white; font-family:var(--mono); line-height:1; }
.mp-hs-label { font-size:10px; color:#6B7280; margin-top:3px; text-transform:uppercase; letter-spacing:.05em; }
.mp-hs-sep { width:1px; background:rgba(255,255,255,.1); align-self:stretch; margin:2px 0; }
.mp-hero-actions { display:flex; flex-direction:column; gap:8px; flex-shrink:0; align-self:center; }
.mp-rank-badge { background:var(--yellow); color:var(--gray-900); padding:6px 16px; border-radius:20px; font-size:12px; font-weight:700; text-align:center; font-family:var(--mono); display:flex; align-items:center; gap:6px; justify-content:center; white-space:nowrap; }
.mp-hero-connections { padding:12px 28px; border-top:1px solid rgba(255,255,255,.07); display:flex; align-items:center; gap:16px; position:relative; z-index:1; }
.mp-hc-avs { display:flex; }
.mp-hc-av { width:24px; height:24px; border-radius:50%; border:2px solid #111827; margin-left:-6px; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:600; flex-shrink:0; }
.mp-hc-av:first-child { margin-left:0; }
.mp-hc-text { font-size:12px; color:#6B7280; }
.mp-hc-text strong { color:rgba(255,255,255,.7); font-weight:500; }

/* TAB BAR */
.mp-tab-bar { background:white; border-bottom:1px solid var(--gray-200); position:sticky; top:56px; z-index:50; }
.mp-tab-bar-inner { max-width:1200px; margin:0 auto; padding:0 28px; display:flex; gap:0; overflow-x:auto; }
.mp-tab-bar-inner::-webkit-scrollbar { display:none; }
.mp-htab { padding:13px 18px; font-size:13px; font-weight:500; color:#6B7280; border-bottom:2px solid transparent; cursor:pointer; transition:color .1s,border-color .1s; white-space:nowrap; display:flex; align-items:center; gap:6px; user-select:none; }
.mp-htab:hover { color:#111827; }
.mp-htab.active { color:#111827; border-bottom-color:#111827; }
.mp-tab-count { font-size:10px; font-family:var(--mono); background:var(--gray-100); color:#6B7280; padding:1px 6px; border-radius:10px; }
.mp-htab.active .mp-tab-count { background:var(--gray-200); color:#374151; }

/* CONTENT */
.mp-content-wrap { max-width:1200px; margin:0 auto; padding:24px 28px; }
.mp-cols { display:grid; grid-template-columns:1fr 320px; gap:20px; align-items:start; }
.mp-col-left { display:flex; flex-direction:column; gap:14px; }
.mp-col-right { display:flex; flex-direction:column; gap:14px; }

/* CARDS */
.mp-card { background:white; border:1px solid var(--gray-200); border-radius:12px; overflow:hidden; }
.mp-card-hdr { padding:14px 18px 10px; border-bottom:1px solid var(--gray-200); display:flex; align-items:center; justify-content:space-between; gap:10px; }
.mp-card-title { font-size:13px; font-weight:600; color:var(--gray-900); display:flex; align-items:center; gap:6px; }

/* STAT BLOCKS */
.mp-stats4 { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--gray-200); border-radius:12px; overflow:hidden; background:white; }
.mp-sb { padding:16px 18px; border-right:1px solid var(--gray-200); }
.mp-sb:last-child { border-right:none; }
.mp-sb-label { font-size:10px; color:#9CA3AF; margin-bottom:5px; text-transform:uppercase; letter-spacing:.06em; font-weight:600; }
.mp-sb-value { font-size:24px; font-weight:700; color:var(--gray-900); font-family:var(--mono); line-height:1; margin-bottom:4px; }
.mp-sb-sub { font-size:14px; font-weight:400; color:#6B7280; }
.mp-sb-delta { font-size:11px; font-family:var(--mono); font-weight:500; }
.mp-delta-up { color:#10B981; }
.mp-delta-neutral { color:#9CA3AF; }
.mp-delta-warn { color:#F97316; }
.mp-sb-bar { height:2px; background:var(--gray-100); border-radius:1px; margin-top:10px; overflow:hidden; }
.mp-sb-bar-fill { height:100%; border-radius:1px; transition:width .6s ease; }

/* ACTIVITY CARDS */
.mp-ac { background:white; border:1px solid var(--gray-200); border-radius:12px; overflow:hidden; transition:border-color .13s,box-shadow .13s; cursor:pointer; }
.mp-ac:hover { border-color:#D1D5DB; box-shadow:0 4px 12px rgba(0,0,0,0.08); }
.mp-ac-body { padding:16px 18px; }
.mp-ac-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.mp-ac-sport-tag { margin-left:auto; font-size:10px; font-weight:600; padding:2px 8px; border-radius:20px; flex-shrink:0; }
.mp-ac-stats { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
.mp-ac-stat { background:var(--gray-50); border:1px solid var(--gray-200); border-radius:6px; padding:6px 10px; text-align:center; min-width:60px; }
.mp-ac-stat .sv { font-size:15px; font-weight:700; color:var(--gray-900); font-family:var(--mono); line-height:1; }
.mp-ac-stat .sl { font-size:9px; color:#9CA3AF; margin-top:2px; text-transform:uppercase; letter-spacing:.04em; }
.mp-ac-desc { font-size:13px; color:#4B5563; line-height:1.55; margin-bottom:8px; }
.mp-ac-ai { background:#FFF9E0; border:1px solid #fde68a; border-radius:6px; padding:9px 12px; display:flex; gap:8px; align-items:flex-start; margin-top:8px; }
.mp-ai-icon { width:18px; height:18px; border-radius:50%; background:var(--yellow); display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; color:var(--gray-900); flex-shrink:0; margin-top:1px; }
.mp-ac-ai-text { font-size:12px; color:#7a5c00; line-height:1.55; }
.mp-ac-footer { padding:10px 18px 14px; border-top:1px solid var(--gray-200); display:flex; align-items:center; gap:8px; }
.mp-ac-action { padding:5px 12px; border-radius:6px; font-size:12px; font-weight:500; border:1px solid var(--gray-200); background:white; color:#4B5563; cursor:pointer; transition:all .12s; font-family:var(--font); }
.mp-ac-action:hover { background:var(--gray-50); }
.mp-ac-action.liked { background:#FFF9E0; border-color:#fde68a; color:#7a5c00; }

/* CHART */
.mp-bar-chart { display:flex; align-items:flex-end; gap:4px; height:80px; padding:16px 18px 0; }
.mp-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer; }
.mp-bar-fill { width:100%; border-radius:4px 4px 0 0; transition:opacity .15s; min-height:3px; }
.mp-bar-col:hover .mp-bar-fill { opacity:.75; }
.mp-bar-label { font-size:9px; color:#9CA3AF; font-family:var(--mono); }
.mp-chart-labels { display:flex; justify-content:space-between; font-size:9px; color:#9CA3AF; font-family:var(--mono); margin-bottom:6px; padding:0 18px; }

/* CALENDAR */
.mp-cal-labels { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; padding:10px 18px 4px; font-size:9px; color:#9CA3AF; text-align:center; text-transform:uppercase; letter-spacing:.05em; font-family:var(--mono); }
.mp-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; padding:0 18px; }
.mp-cal-day { aspect-ratio:1; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:9px; font-family:var(--mono); cursor:default; transition:transform .1s; }
.mp-cal-day:hover { transform:scale(1.15); }
.mp-cd-rest { background:var(--gray-100); color:#9CA3AF; }
.mp-cd-light { background:#D1FAE5; color:#065F46; }
.mp-cd-med { background:#6EE7B7; color:#064E3B; }
.mp-cd-hard { background:#10B981; color:white; }
.mp-cd-race { background:var(--yellow); color:var(--gray-900); font-weight:700; }
.mp-cd-today { background:#10B981; color:white; outline:2px solid #111827; }
.mp-cal-legend { display:flex; align-items:center; gap:10px; padding:8px 18px 14px; flex-wrap:wrap; }
.mp-cl-item { display:flex; align-items:center; gap:4px; font-size:10px; color:#6B7280; }
.mp-cl-dot { width:10px; height:10px; border-radius:2px; }

/* SPORT BREAKDOWN */
.mp-sport-bk { display:flex; flex-direction:column; gap:10px; padding:14px 18px; }
.mp-sb-row { display:flex; align-items:center; gap:10px; }
.mp-sb-sport { font-size:13px; font-weight:500; color:var(--gray-900); width:80px; flex-shrink:0; }
.mp-sb-track { flex:1; height:6px; background:var(--gray-100); border-radius:3px; overflow:hidden; }
.mp-sb-fill { height:100%; border-radius:3px; transition:width .6s ease .2s; }
.mp-sb-meta { font-size:11px; font-family:var(--mono); color:#6B7280; white-space:nowrap; flex-shrink:0; min-width:80px; text-align:right; }

/* LEADERBOARD */
.mp-lb-row { display:flex; align-items:center; gap:10px; padding:9px 18px; border-bottom:1px solid var(--gray-200); cursor:pointer; transition:background .1s; }
.mp-lb-row:hover { background:var(--gray-50); }
.mp-lb-row:last-child { border-bottom:none; }
.mp-lb-row.is-you { background:#FFFBEB; }
.mp-lb-rank { font-family:var(--mono); font-size:13px; color:#9CA3AF; width:28px; text-align:center; font-weight:600; }
.mp-lb-rank.r1 { color:#D97706; }
.mp-lb-rank.r2 { color:#6B7280; }
.mp-lb-rank.r3 { color:#B45309; }
.mp-lb-av { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:600; flex-shrink:0; }
.mp-lb-name { flex:1; font-size:13px; font-weight:500; color:var(--gray-900); }
.mp-lb-score { font-size:12px; font-family:var(--mono); color:#374151; font-weight:600; }
.mp-you-tag { font-size:10px; font-weight:600; padding:1px 7px; border-radius:10px; background:#FFF9E0; color:#7a5c00; border:1px solid #fde68a; }

/* PERSONAL BESTS */
.mp-pb-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:14px 18px; }
.mp-pb-card { background:var(--gray-50); border:1px solid var(--gray-200); border-radius:8px; padding:12px 14px; }
.mp-pb-card.dashed { border-style:dashed; }
.mp-pb-event { font-size:11px; color:#6B7280; margin-bottom:3px; text-transform:uppercase; letter-spacing:.05em; font-weight:600; }
.mp-pb-time { font-size:20px; font-weight:700; color:var(--gray-900); font-family:var(--mono); line-height:1; margin-bottom:3px; }
.mp-pb-time.muted { color:#9CA3AF; }
.mp-pb-date { font-size:10px; color:#9CA3AF; font-family:var(--mono); }
.mp-pb-delta { font-size:11px; color:#10B981; font-family:var(--mono); margin-top:3px; font-weight:600; }

/* ACHIEVEMENTS */
.mp-ach-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:0; }
.mp-ach-card { border:1px solid var(--gray-200); border-radius:12px; padding:14px; text-align:center; transition:border-color .13s,box-shadow .13s,transform .13s; }
.mp-ach-card:hover { border-color:#D1D5DB; box-shadow:0 4px 12px rgba(0,0,0,0.08); transform:translateY(-2px); }
.mp-ach-card.locked { opacity:.45; filter:grayscale(.6); }
.mp-ach-card.gold { background:linear-gradient(135deg,#FFFBEB 0%,#FEF9C3 100%); border-color:#FDE68A; }
.mp-ach-card.silver { background:linear-gradient(135deg,var(--gray-50) 0%,var(--gray-100) 100%); border-color:#D1D5DB; }
.mp-ach-card.bronze { background:linear-gradient(135deg,#FFF7ED 0%,#FEF3C7 100%); border-color:#FDBA74; }
.mp-ach-icon { font-size:28px; margin-bottom:8px; display:block; }
.mp-ach-name { font-size:12px; font-weight:600; color:var(--gray-900); margin-bottom:3px; }
.mp-ach-desc { font-size:10px; color:#6B7280; line-height:1.4; }
.mp-ach-date { font-size:10px; color:#9CA3AF; margin-top:5px; font-family:var(--mono); }

/* CLUBS */
.mp-club-card { background:white; border:1px solid var(--gray-200); border-radius:12px; padding:14px 16px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:border-color .13s,box-shadow .13s; }
.mp-club-card:hover { border-color:#D1D5DB; box-shadow:0 4px 12px rgba(0,0,0,0.08); }
.mp-club-icon { width:42px; height:42px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
.mp-club-name { font-size:14px; font-weight:600; color:var(--gray-900); margin-bottom:2px; }
.mp-club-meta { font-size:12px; color:#6B7280; }
.mp-discover { border:2px dashed var(--gray-200); border-radius:12px; padding:24px; text-align:center; cursor:pointer; transition:border-color .15s; background:white; }
.mp-discover:hover { border-color:#9CA3AF; }

/* FOLLOWING */
.mp-follow-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:14px 18px; }
.mp-follow-card { display:flex; align-items:center; gap:9px; cursor:pointer; padding:6px; border-radius:8px; transition:background .1s; }
.mp-follow-card:hover { background:var(--gray-50); }
.mp-fc-av { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; flex-shrink:0; }
.mp-fc-name { font-size:13px; font-weight:600; color:var(--gray-900); }
.mp-fc-sport { font-size:11px; color:#6B7280; }
.mp-fc-streak { font-size:10px; font-family:var(--mono); color:#9CA3AF; margin-top:1px; }

/* SETTINGS */
.mp-settings-sec { padding:20px 24px; }
.mp-settings-sec + .mp-settings-sec { border-top:1px solid var(--gray-200); }
.mp-ss-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:#6B7280; margin-bottom:14px; }
.mp-form-field { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; }
.mp-form-label { font-size:12px; font-weight:600; color:#374151; }
.mp-form-input { padding:8px 11px; border:1px solid var(--gray-200); border-radius:8px; font-size:13px; color:#1F2937; outline:none; transition:border-color .13s; font-family:var(--font); }
.mp-form-input:focus { border-color:#9CA3AF; box-shadow:0 0 0 3px rgba(107,114,128,0.08); }
.mp-form-input::placeholder { color:#9CA3AF; }
.mp-form-select { padding:8px 11px; border:1px solid var(--gray-200); border-radius:8px; font-size:13px; color:#374151; background:white; outline:none; cursor:pointer; font-family:var(--font); }
.mp-form-textarea { padding:8px 11px; border:1px solid var(--gray-200); border-radius:8px; font-size:13px; color:#1F2937; outline:none; resize:vertical; min-height:72px; line-height:1.5; transition:border-color .13s; font-family:var(--font); }
.mp-form-textarea:focus { border-color:#9CA3AF; box-shadow:0 0 0 3px rgba(107,114,128,0.08); }
.mp-form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.mp-form-hint { font-size:11px; color:#9CA3AF; margin-top:2px; }
.mp-sport-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:5px; }
.mp-sport-chip { padding:5px 13px; border-radius:20px; font-size:12px; font-weight:500; border:1px solid var(--gray-200); background:white; color:#4B5563; cursor:pointer; transition:all .12s; font-family:var(--font); }
.mp-sport-chip:hover { border-color:#9CA3AF; }
.mp-sport-chip.on { background:#FFF9E0; border-color:#fde68a; color:#7a5c00; }
.mp-int-row { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--gray-200); }
.mp-int-row:last-child { border-bottom:none; }
.mp-ir-left { display:flex; align-items:center; gap:12px; }
.mp-ir-icon { font-size:22px; width:36px; text-align:center; }
.mp-ir-name { font-size:13px; font-weight:600; color:var(--gray-900); }
.mp-ir-status { font-size:11px; margin-top:1px; }
.mp-toggle-row { display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--gray-200); }
.mp-toggle-row:last-child { border-bottom:none; }
.mp-toggle { width:36px; height:20px; border-radius:10px; position:relative; cursor:pointer; transition:background .2s; flex-shrink:0; border:none; outline:none; }
.mp-toggle.on { background:#10B981; }
.mp-toggle.off { background:#D1D5DB; }
.mp-toggle::after { content:''; position:absolute; top:2px; width:16px; height:16px; border-radius:50%; background:white; transition:left .2s; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
.mp-toggle.on::after { left:18px; }
.mp-toggle.off::after { left:2px; }
.mp-pr-text { font-size:13px; color:#1F2937; }
.mp-pr-sub { font-size:11px; color:#6B7280; margin-top:1px; }
.mp-danger { border:1px solid #FECACA; border-radius:12px; padding:16px 20px; background:#FFF5F5; }
.mp-dz-title { font-size:13px; font-weight:600; color:#EF4444; margin-bottom:3px; }
.mp-dz-sub { font-size:12px; color:#4B5563; margin-bottom:12px; }

/* PILLS */
.mp-pill { padding:2px 8px; border-radius:20px; font-size:11px; font-weight:500; border:1px solid transparent; white-space:nowrap; display:inline-block; }
.mp-pill-run { background:#FFF7ED; color:#9A3412; border-color:#FDBA74; }
.mp-pill-gray { background:var(--gray-100); color:#4B5563; border-color:var(--gray-200); }
.mp-pill-new { background:#FFF9E0; color:#7a5c00; border-color:#fde68a; }

/* BUTTONS */
.mp-btn { padding:7px 14px; border-radius:7px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid var(--gray-200); transition:all .13s; display:inline-flex; align-items:center; gap:6px; text-decoration:none; font-family:var(--font); }
.mp-btn-ghost { background:transparent; color:#374151; }
.mp-btn-ghost:hover { background:var(--gray-100); }
.mp-btn-primary { background:#111827; color:white; border-color:#111827; }
.mp-btn-primary:hover { background:#374151; }
.mp-btn-yellow { background:var(--yellow); color:var(--gray-900); border-color:#E6B800; font-weight:600; }
.mp-btn-yellow:hover { background:#E6B800; }
.mp-btn-sm { padding:4px 10px; font-size:12px; border-radius:6px; }
.mp-btn-full { width:100%; justify-content:center; }
.mp-btn-red { background:#FEF2F2; color:#A32D2D; border-color:#FECACA; }
.mp-btn-red:hover { background:#FEE2E2; }
.mp-btn-white-ghost { background:transparent; color:rgba(255,255,255,.6); border-color:rgba(255,255,255,.15); }
.mp-btn-white-ghost:hover { background:rgba(255,255,255,.08); color:white; }

/* MODAL */
.mp-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:500; display:flex; align-items:center; justify-content:center; padding:24px; backdrop-filter:blur(3px); animation:mp-fade-up .15s ease; }
.mp-modal { background:white; border-radius:16px; width:100%; max-width:500px; max-height:88vh; overflow-y:auto; box-shadow:0 10px 40px rgba(0,0,0,0.12); animation:mp-scale-in .2s ease; }
.mp-modal-hdr { padding:22px 26px 18px; border-bottom:1px solid var(--gray-200); display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.mp-modal-title { font-size:18px; font-weight:700; color:var(--gray-900); }
.mp-modal-close { width:28px; height:28px; border-radius:50%; border:1px solid var(--gray-200); background:white; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; color:#6B7280; transition:background .1s; font-family:var(--font); }
.mp-modal-close:hover { background:var(--gray-100); }
.mp-modal-body { padding:22px 26px; display:flex; flex-direction:column; gap:14px; }
.mp-modal-footer { padding:16px 26px; border-top:1px solid var(--gray-200); display:flex; gap:10px; background:var(--gray-50); }

/* TOAST */
.mp-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(80px); background:#111827; color:white; padding:10px 20px; border-radius:8px; font-size:13px; font-weight:500; z-index:999; transition:transform .3s ease; white-space:nowrap; box-shadow:0 4px 12px rgba(0,0,0,0.12); pointer-events:none; }
.mp-toast.show { transform:translateX(-50%) translateY(0); }

/* GOAL PROGRESS */
.mp-goal-bar-wrap { height:5px; background:var(--gray-100); border-radius:3px; overflow:hidden; }
.mp-goal-bar-fill { height:100%; border-radius:3px; }

/* ALL-TIME TOTALS */
.mp-total-row { display:flex; justify-content:space-between; align-items:baseline; padding:6px 0; border-bottom:1px solid var(--gray-200); }
.mp-total-row:last-child { border-bottom:none; }
.mp-total-label { font-size:13px; color:#4B5563; }
.mp-total-val { font-size:16px; font-weight:700; font-family:var(--mono); color:var(--gray-900); }
`;

/* ─── COMPONENT ─────────────────────────────────────────────────────── */
type ModalId = "edit-profile" | "comment" | "avatar" | "goal" | null;
type TabId = "overview" | "activities" | "stats" | "achievements" | "clubs" | "following" | "settings";

export default function Profile() {
  const [tab, setTab] = useState<TabId>("overview");
  const [modal, setModal] = useState<ModalId>(null);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [kudos, setKudos] = useState<Record<string, number>>({ ac1: 6, ac2: 11, ac3: 4, ac4: 6, ac5: 11, ac6: 4 });
  const [liked, setLiked] = useState<Record<string, boolean>>({ ac1: true });
  const [followState, setFollowState] = useState<Record<string, boolean>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    pub: true, lb: true, gps: true, feed: true, dm: false,
    kudosN: true, comments: true, followers: true, challenges: true, events: true, aiSummary: true,
  });
  const [sportChips, setSportChips] = useState<Record<string, boolean>>({
    running: true, cycling: true, climbing: true, swimming: false, football: false, weightlifting: false, tennis: false, surfing: false,
  });
  const [followMode, setFollowMode] = useState<"following" | "followers">("following");

  function showToast(msg: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2800);
  }

  function switchTab(t: TabId) {
    setTab(t);
    setTimeout(() => {
      document.getElementById("mp-tab-bar")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function toggleKudos(id: string) {
    const isLiked = liked[id];
    setLiked(prev => ({ ...prev, [id]: !isLiked }));
    setKudos(prev => ({ ...prev, [id]: (prev[id] ?? 0) + (isLiked ? -1 : 1) }));
  }

  function toggleFollow(name: string) {
    setFollowState(prev => ({ ...prev, [name]: !prev[name] }));
    showToast(followState[name] ? `Followed ${name}` : `Unfollowed ${name}`);
  }

  function toggleToggle(key: string) {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <>
      <style>{CSS}</style>

      <div className="mp-app">
        {/* ── TOPBAR ── */}
        <header className="mp-topbar">
          <div className="mp-topbar-logo">
            <div className="mp-logo-icon">🏟</div>
            <span className="mp-logo-text">Arenas</span>
          </div>
          <div className="mp-topbar-center">
            <div className="mp-search">
              <span style={{ color: "#9CA3AF", fontSize: "13px" }}>🔍</span>
              <input type="text" placeholder="Search athletes, clubs, events…" />
            </div>
          </div>
          <div className="mp-topbar-actions">
            <div className="mp-notif" onClick={() => showToast("3 new notifications")}>
              🔔<div className="mp-notif-dot" />
            </div>
            <div className="mp-user-av" onClick={() => showToast("That's you!")}>JK</div>
          </div>
        </header>

        {/* ── SIDEBAR ── */}
        <aside className="mp-sidebar">
          <div className="mp-nav-label">My Arenas</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening feed…")}><span className="mp-nav-icon">🏠</span> Feed</div>
          <div className={`mp-nav-item ${tab !== "settings" ? "active" : ""}`} onClick={() => switchTab("overview")}><span className="mp-nav-icon">👤</span> My profile</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening events…")}><span className="mp-nav-icon">📅</span> Events</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening leaderboards…")}><span className="mp-nav-icon">🏆</span> Leaderboards</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening challenges…")}><span className="mp-nav-icon">⚡</span> Challenges <span className="mp-nav-badge">3</span></div>
          <div className="mp-nav-item" onClick={() => showToast("Opening athletes…")}><span className="mp-nav-icon">👥</span> Athletes</div>
          <div className="mp-nav-label">Clubs</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening club…")}><span className="mp-nav-icon">🏃</span> Hackney RC <span className="mp-nav-badge red">2</span></div>
          <div className="mp-nav-label">Account</div>
          <div className={`mp-nav-item ${tab === "settings" ? "active" : ""}`} onClick={() => switchTab("settings")}><span className="mp-nav-icon">⚙️</span> Settings</div>
          <div className="mp-nav-item" onClick={() => showToast("Opening billing…")}><span className="mp-nav-icon">💳</span> Pro plan</div>
          <div className="mp-sf">
            <div className="mp-sf-row">
              <div className="mp-sf-av">JK</div>
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--gray-900)" }}>Jamie King</div>
                <div style={{ fontSize: "10px", color: "#6B7280" }}>@jamiek · Pro</div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="mp-main">

          {/* ── PROFILE HERO ── */}
          <div className="mp-hero">
            <div className="mp-hero-bg" />
            <div className="mp-hero-grid" />
            <div className="mp-hero-inner">
              <div className="mp-hero-av-wrap">
                <div className="mp-hero-av" onClick={() => setModal("avatar")}>JK</div>
                <div className="mp-hero-av-edit" onClick={() => setModal("avatar")}>✏️</div>
                <div className="mp-hero-online" title="Online now" />
              </div>
              <div className="mp-hero-info">
                <div className="mp-hero-name">Jamie King</div>
                <div className="mp-hero-handle">@jamiek · London, UK · Member since Apr 2026</div>
                <div className="mp-hero-tags">
                  <span className="mp-hero-tag mp-tag-run">🏃 Running</span>
                  <span className="mp-hero-tag mp-tag-cyc">🚴 Cycling</span>
                  <span className="mp-hero-tag mp-tag-clm">🧗 Climbing</span>
                  <span className="mp-hero-tag mp-tag-adv">Advanced</span>
                  <span className="mp-hero-tag">✦ Pro</span>
                </div>
                <div className="mp-hero-bio">
                  Marathon runner, weekend cyclist, occasional wall climber. Chasing a sub-3:30 marathon. Hackney RC member since 2024. Always looking for Sunday long run partners in East London.
                </div>
              </div>
              <div className="mp-hero-stats">
                <div className="mp-hs"><div className="mp-hs-val">312</div><div className="mp-hs-label">Activities</div></div>
                <div className="mp-hs-sep" />
                <div className="mp-hs"><div className="mp-hs-val">4,820</div><div className="mp-hs-label">km logged</div></div>
                <div className="mp-hs-sep" />
                <div className="mp-hs"><div className="mp-hs-val">142</div><div className="mp-hs-label">Followers</div></div>
                <div className="mp-hs-sep" />
                <div className="mp-hs"><div className="mp-hs-val">89</div><div className="mp-hs-label">Following</div></div>
              </div>
              <div className="mp-hero-actions">
                <div className="mp-rank-badge">🏆 #5 Hackney RC · #2,841 Global</div>
                <button className="mp-btn mp-btn-yellow mp-btn-sm mp-btn-full" onClick={() => setModal("edit-profile")}>✏️ Edit profile</button>
                <button className="mp-btn mp-btn-white-ghost mp-btn-sm mp-btn-full" onClick={() => {
                  navigator.clipboard?.writeText("https://arenas.io/athletes/jamiek").catch(() => {});
                  showToast("✓ Profile link copied — arenas.io/athletes/jamiek");
                }}>🔗 Share profile</button>
              </div>
            </div>
            <div className="mp-hero-connections">
              <div className="mp-hc-avs">
                {[["SL","#FEF9C3","#854D0E"],["YT","#FCE7F3","#9D174D"],["AL","#E0F2FE","#0369A1"],["TR","#F5F3FF","#5B21B6"]].map(([i,bg,fg])=>(
                  <div key={i} className="mp-hc-av" style={{background:bg,color:fg}}>{i}</div>
                ))}
                <div className="mp-hc-av" style={{background:"var(--gray-200)",color:"#6B7280",fontSize:"7px"}}>+85</div>
              </div>
              <div className="mp-hc-text"><strong>Sofia L., Yuki T., Alena L.</strong> and 86 others follow you</div>
            </div>
          </div>

          {/* ── TAB BAR ── */}
          <div className="mp-tab-bar" id="mp-tab-bar">
            <div className="mp-tab-bar-inner">
              {([
                ["overview","Overview",null],
                ["activities","Activities","312"],
                ["stats","Stats & PRs",null],
                ["achievements","Achievements","18"],
                ["clubs","Clubs","1"],
                ["following","Following","89"],
                ["settings","Settings",null],
              ] as [TabId, string, string|null][]).map(([id,label,count])=>(
                <div key={id} className={`mp-htab${tab===id?" active":""}`} onClick={()=>switchTab(id)}>
                  {label}{count && <span className="mp-tab-count">{count}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ════════ OVERVIEW ════════ */}
          {tab === "overview" && (
            <div className="mp-content-wrap">
              <div className="mp-cols">
                <div className="mp-col-left">
                  {/* Stat cards */}
                  <div className="mp-stats4">
                    <div className="mp-sb">
                      <div className="mp-sb-bar"><div className="mp-sb-bar-fill" style={{width:"72%",background:"#F97316"}} /></div>
                      <div className="mp-sb-label">This week</div>
                      <div className="mp-sb-value">12.4<span className="mp-sb-sub"> km</span></div>
                      <div className="mp-sb-delta mp-delta-up">↑ +3.2km vs last wk</div>
                    </div>
                    <div className="mp-sb">
                      <div className="mp-sb-bar"><div className="mp-sb-bar-fill" style={{width:"44%",background:"#3B82F6"}} /></div>
                      <div className="mp-sb-label">This month</div>
                      <div className="mp-sb-value">62.4<span className="mp-sb-sub"> km</span></div>
                      <div className="mp-sb-delta mp-delta-up">↑ +8km vs last mo</div>
                    </div>
                    <div className="mp-sb">
                      <div className="mp-sb-bar"><div className="mp-sb-bar-fill" style={{width:"60%",background:"#8B5CF6"}} /></div>
                      <div className="mp-sb-label">Current streak</div>
                      <div className="mp-sb-value">6<span className="mp-sb-sub"> days</span></div>
                      <div className="mp-sb-delta mp-delta-neutral">Best: 14 days</div>
                    </div>
                    <div className="mp-sb">
                      <div className="mp-sb-bar"><div className="mp-sb-bar-fill" style={{width:"100%",background:"#E6B800"}} /></div>
                      <div className="mp-sb-label">Club rank</div>
                      <div className="mp-sb-value">#5<span className="mp-sb-sub"> /48</span></div>
                      <div className="mp-sb-delta mp-delta-up">↑ +3 this week</div>
                    </div>
                  </div>

                  {/* Recent activities */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">🏃 Recent activities</span>
                      <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>switchTab("activities")}>All 312 →</button>
                    </div>
                    <ActivityCard
                      id="ac1" title="Morning long run" time="Today · 6:42 AM · London"
                      sport="🏃 Running" sportBg="#FFF7ED" sportColor="#9A3412" sportBorder="#FDBA74"
                      avBg="#FFF7ED" avColor="#9A3412"
                      stats={[{v:"12.4",l:"km"},{v:"54:22",l:"time"},{v:"4:23",l:"/km"},{v:"148",l:"bpm"},{v:"486",l:"kcal"}]}
                      desc="Morning long run ✓ Legs felt heavy miles 8–10 but pushed through. PB attempt Sunday — anyone in London want to pace the last 5km?"
                      ai="HR spiked 12 bpm in the final 3km — classic glycogen depletion. Keep tomorrow easy and you'll be fresh for Sunday's PB attempt. Consider fuelling at km 8 next long run."
                      kudosCount={kudos.ac1} isLiked={!!liked.ac1}
                      onKudos={()=>toggleKudos("ac1")} onComment={()=>setModal("comment")} onShare={()=>showToast("Activity link copied!")}
                      bordered={false} style={{borderBottom:"1px solid var(--gray-200)",borderRadius:0}}
                    />
                    <ActivityCard
                      id="ac2" title="Evening tempo ride" time="Yesterday · 6:15 PM · London"
                      sport="🚴 Cycling" sportBg="#EFF6FF" sportColor="#1E40AF" sportBorder="#93C5FD"
                      avBg="#EFF6FF" avColor="#1E40AF"
                      stats={[{v:"34.8",l:"km"},{v:"1:12:04",l:"time"},{v:"29.1",l:"km/h"},{v:"218",l:"avg W"}]}
                      desc="Threshold intervals on the Regents Park loop. Held 230W for the 3×8 blocks — best ever. New FTP test incoming."
                      ai="230W for 3×8 blocks is excellent — your FTP is clearly higher than your tested number. Schedule a test next week while you're feeling strong."
                      kudosCount={kudos.ac2} isLiked={!!liked.ac2}
                      onKudos={()=>toggleKudos("ac2")} onComment={()=>setModal("comment")} onShare={()=>showToast("Activity link copied!")}
                      bordered={false} style={{borderRadius:0}}
                    />
                  </div>

                  {/* 8-week bar chart */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">📊 Training volume — last 8 weeks</span>
                      <select style={{fontSize:"12px",border:"1px solid var(--gray-200)",borderRadius:"6px",padding:"3px 8px",outline:"none",cursor:"pointer",background:"white",fontFamily:"var(--font)"}} onChange={()=>showToast("View updated")}>
                        <option>Distance (km)</option><option>Time (hrs)</option><option>Elevation (m)</option>
                      </select>
                    </div>
                    <div style={{padding:"16px 18px 0"}}>
                      <div className="mp-chart-labels">
                        {WEEK_DATA.map(w=><span key={w.label}>{w.label}</span>)}
                      </div>
                      <div className="mp-bar-chart">
                        {WEEK_DATA.map(w=>(
                          <div key={w.label} className="mp-bar-col" onClick={()=>showToast(`Week of ${w.label}: ${w.km}km`)}>
                            <div className="mp-bar-fill" style={{height:`${(w.km/MAX_KM)*100}%`,background:`linear-gradient(180deg,${w.color},${w.color}88)`}} />
                            <div className="mp-bar-label" style={{color:w.km===MAX_KM?"#EA580C":w.color==="#FFD21E"?"#E6B800":undefined,fontWeight:w.km===MAX_KM?600:undefined}}>{w.km}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:"14px",padding:"10px 18px 14px",borderTop:"1px solid var(--gray-200)",marginTop:"8px"}}>
                      <div style={{fontSize:"12px",color:"#4B5563"}}>8-week total: <strong style={{color:"var(--gray-900)",fontFamily:"var(--mono)"}}>399.2 km</strong></div>
                      <div style={{fontSize:"12px",color:"#4B5563"}}>Average: <strong style={{color:"var(--gray-900)",fontFamily:"var(--mono)"}}>49.9 km/wk</strong></div>
                      <div style={{fontSize:"12px",color:"#10B981"}}>↑ +12% vs prior 8 weeks</div>
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="mp-col-right">
                  {/* Activity calendar */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">🔥 Activity streak</span>
                      <span style={{fontSize:"12px",fontFamily:"var(--mono)",color:"#F97316",fontWeight:600}}>6 days</span>
                    </div>
                    <div className="mp-cal-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
                    <div className="mp-cal-grid">
                      {CAL_TYPES.map((type,i)=>{
                        const cls = type==="rest"?"mp-cd-rest":type==="light"?"mp-cd-light":type==="med"?"mp-cd-med":type==="hard"?"mp-cd-hard":type==="race"?"mp-cd-race":"mp-cd-today";
                        const lbl = type==="today"?"↓":type==="race"?"🏁":"";
                        const title = type==="rest"?"Rest day":type==="race"?"Race day!":type==="today"?"Today":"Activity logged";
                        return <div key={i} className={`mp-cal-day ${cls}`} title={title}>{lbl}</div>;
                      })}
                    </div>
                    <div className="mp-cal-legend">
                      <div className="mp-cl-item"><div className="mp-cl-dot" style={{background:"var(--gray-100)"}} />Rest</div>
                      <div className="mp-cl-item"><div className="mp-cl-dot" style={{background:"#D1FAE5"}} />Easy</div>
                      <div className="mp-cl-item"><div className="mp-cl-dot" style={{background:"#10B981"}} />Hard</div>
                      <div className="mp-cl-item"><div className="mp-cl-dot" style={{background:"var(--yellow)"}} />Race</div>
                    </div>
                  </div>

                  {/* Sport breakdown */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">⚡ Sport breakdown</span>
                      <span style={{fontSize:"11px",color:"#9CA3AF"}}>last 90 days</span>
                    </div>
                    <div className="mp-sport-bk">
                      {[
                        {name:"🏃 Running",pct:74,color:"#F97316",meta:"74% · 296km"},
                        {name:"🚴 Cycling",pct:19,color:"#3B82F6",meta:"19% · 76km"},
                        {name:"🧗 Climbing",pct:7,color:"#8B5CF6",meta:"7% · 12 sess"},
                      ].map(s=>(
                        <div key={s.name} className="mp-sb-row">
                          <span className="mp-sb-sport">{s.name}</span>
                          <div className="mp-sb-track"><div className="mp-sb-fill" style={{width:`${s.pct}%`,background:s.color}} /></div>
                          <span className="mp-sb-meta">{s.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Club leaderboard */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">🏆 Hackney RC board</span>
                      <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>showToast("Opening club leaderboard…")}>Full →</button>
                    </div>
                    <div>
                      {[
                        {rank:"1",cls:"r1",init:"SL",bg:"#FEF9C3",fg:"#854D0E",name:"Sofia L.",score:"9,840",isYou:false},
                        {rank:"2",cls:"r2",init:"YT",bg:"#FCE7F3",fg:"#9D174D",name:"Yuki T.",score:"7,610",isYou:false},
                        {rank:"3",cls:"r3",init:"AL",bg:"#E0F2FE",fg:"#0369A1",name:"Alena L.",score:"7,220",isYou:false},
                        {rank:"5",cls:"",init:"JK",bg:"var(--yellow)",fg:"var(--gray-900)",name:"You",score:"6,440",isYou:true},
                      ].map(r=>(
                        <div key={r.rank} className={`mp-lb-row${r.isYou?" is-you":""}`}>
                          <span className={`mp-lb-rank${r.cls?" "+r.cls:""}`}>{r.rank}</span>
                          <div className="mp-lb-av" style={{background:r.bg,color:r.fg}}>{r.init}</div>
                          <span className="mp-lb-name">{r.name}</span>
                          <span className="mp-lb-score">{r.score}</span>
                          {r.isYou && <span className="mp-you-tag">you</span>}
                        </div>
                      ))}
                    </div>
                    <div style={{padding:"8px 18px 12px",borderTop:"1px solid var(--gray-200)",fontSize:"12px",color:"#6B7280"}}>
                      540 pts to overtake Priya R. for rank #4 — log one more run.
                    </div>
                  </div>

                  {/* Active challenges */}
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">⚡ Active challenges</span>
                      <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>showToast("Opening challenges…")}>All →</button>
                    </div>
                    <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:"10px"}}>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",marginBottom:"5px"}}>
                          <span style={{fontWeight:600,color:"var(--gray-900)"}}>100km May Run</span>
                          <span style={{fontFamily:"var(--mono)",color:"#6B7280"}}>62 / 100 km</span>
                        </div>
                        <div className="mp-goal-bar-wrap"><div className="mp-goal-bar-fill" style={{width:"62%",background:"#F97316"}} /></div>
                        <div style={{fontSize:"11px",color:"#9CA3AF",marginTop:"3px"}}>9 days left · rank #5 of 44</div>
                      </div>
                      <div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",marginBottom:"5px"}}>
                          <span style={{fontWeight:600,color:"var(--gray-900)"}}>7-day streak</span>
                          <span style={{fontFamily:"var(--mono)",color:"#6B7280"}}>6 / 7 days</span>
                        </div>
                        <div className="mp-goal-bar-wrap"><div className="mp-goal-bar-fill" style={{width:"86%",background:"#8B5CF6"}} /></div>
                        <div style={{fontSize:"11px",color:"#F97316",marginTop:"3px",fontWeight:600}}>Run today to complete this week! Don't break it now.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════ ACTIVITIES ════════ */}
          {tab === "activities" && (
            <div className="mp-content-wrap">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
                <div>
                  <h2 style={{fontSize:"17px",fontWeight:700,color:"var(--gray-900)"}}>All activities</h2>
                  <p style={{fontSize:"13px",color:"#6B7280"}}>312 activities · 4,820 km total</p>
                </div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                  <select style={{padding:"7px 11px",border:"1px solid var(--gray-200)",borderRadius:"7px",fontSize:"13px",background:"white",outline:"none",cursor:"pointer",fontFamily:"var(--font)"}} onChange={()=>showToast("Filter updated")}>
                    <option>All sports</option><option>Running</option><option>Cycling</option><option>Climbing</option>
                  </select>
                  <select style={{padding:"7px 11px",border:"1px solid var(--gray-200)",borderRadius:"7px",fontSize:"13px",background:"white",outline:"none",cursor:"pointer",fontFamily:"var(--font)"}} onChange={()=>showToast("Sort updated")}>
                    <option>Newest first</option><option>Oldest first</option><option>Longest distance</option><option>Fastest pace</option>
                  </select>
                  <button className="mp-btn mp-btn-ghost" onClick={()=>showToast("Downloading GPX files…")}>📥 Export</button>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
                <ActivityCard id="ac4" title="Morning long run" time="Today · 6:42 AM · London"
                  sport="🏃 Running" sportBg="#FFF7ED" sportColor="#9A3412" sportBorder="#FDBA74"
                  avBg="#FFF7ED" avColor="#9A3412"
                  stats={[{v:"12.4",l:"km"},{v:"54:22",l:"time"},{v:"4:23",l:"/km"},{v:"148",l:"bpm"},{v:"486",l:"kcal"},{v:"+320",l:"elev m"}]}
                  desc="Morning long run ✓ Legs felt heavy miles 8–10 but pushed through. PB attempt Sunday."
                  ai="HR spiked 12 bpm in the final 3km — classic glycogen depletion. Keep tomorrow easy and you'll be fresh for Sunday's PB attempt."
                  kudosCount={kudos.ac4} isLiked={!!liked.ac4}
                  onKudos={()=>toggleKudos("ac4")} onComment={()=>setModal("comment")} onShare={()=>showToast("Activity link copied!")}
                  showEdit onEdit={()=>showToast("Editing activity…")}
                />
                <ActivityCard id="ac5" title="Evening tempo ride" time="Yesterday · 6:15 PM · London"
                  sport="🚴 Cycling" sportBg="#EFF6FF" sportColor="#1E40AF" sportBorder="#93C5FD"
                  avBg="#EFF6FF" avColor="#1E40AF"
                  stats={[{v:"34.8",l:"km"},{v:"1:12:04",l:"time"},{v:"29.1",l:"km/h"},{v:"218",l:"avg W"},{v:"162",l:"bpm"}]}
                  desc="Threshold intervals on the Regents Park loop. Held 230W for the 3×8 blocks — best ever."
                  ai="230W for 3×8 blocks is excellent — your FTP is clearly higher than your tested number. Schedule a test next week while you're feeling strong."
                  kudosCount={kudos.ac5} isLiked={!!liked.ac5}
                  onKudos={()=>toggleKudos("ac5")} onComment={()=>setModal("comment")} onShare={()=>showToast("Activity link copied!")}
                />
                <ActivityCard id="ac6" title="Bouldering session — The Arch" time="May 18 · 11:00 AM · Bermondsey"
                  sport="🧗 Climbing" sportBg="#F5F3FF" sportColor="#5B21B6" sportBorder="#C4B5FD"
                  avBg="#F5F3FF" avColor="#5B21B6"
                  stats={[{v:"V5",l:"top grade"},{v:"2h 10m",l:"duration"},{v:"12",l:"problems"}]}
                  desc="Great session — sent the V5 crimp project from two weeks ago. Felt solid on slopers. Working a V6 compression problem next."
                  kudosCount={kudos.ac6} isLiked={!!liked.ac6}
                  onKudos={()=>toggleKudos("ac6")} onComment={()=>setModal("comment")} onShare={()=>showToast("Activity link copied!")}
                />
              </div>
              <div style={{textAlign:"center",marginTop:"16px"}}>
                <button className="mp-btn mp-btn-ghost" onClick={()=>showToast("Loading more activities…")}>Load more activities</button>
              </div>
            </div>
          )}

          {/* ════════ STATS & PRs ════════ */}
          {tab === "stats" && (
            <div className="mp-content-wrap">
              <div style={{display:"flex",gap:"20px",flexWrap:"wrap",alignItems:"start"}}>
                <div style={{flex:1,minWidth:"300px",display:"flex",flexDirection:"column",gap:"14px"}}>
                  {/* Running PRs */}
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🏃 Running personal bests</span></div>
                    <div className="mp-pb-grid">
                      <div className="mp-pb-card"><div className="mp-pb-event">5 km</div><div className="mp-pb-time">25:48</div><div className="mp-pb-date">Apr 19, 2026 · Parkrun</div><div className="mp-pb-delta">↑ −23s vs prev PB</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">10 km</div><div className="mp-pb-time">53:14</div><div className="mp-pb-date">Mar 2, 2026</div><div className="mp-pb-delta">↑ −1:12 vs prev PB</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">Half marathon</div><div className="mp-pb-time">1:54:22</div><div className="mp-pb-date">Jan 12, 2026</div><div className="mp-pb-delta">↑ −4:08 vs prev PB</div></div>
                      <div className="mp-pb-card dashed"><div className="mp-pb-event">Marathon</div><div className="mp-pb-time muted">No result yet</div><div className="mp-pb-date">Target: sub 3:30</div><div style={{fontSize:"11px",color:"#F97316",marginTop:"4px"}}>London Marathon Oct '26</div></div>
                    </div>
                  </div>
                  {/* Cycling */}
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🚴 Cycling bests</span></div>
                    <div className="mp-pb-grid">
                      <div className="mp-pb-card"><div className="mp-pb-event">FTP</div><div className="mp-pb-time">241 W</div><div className="mp-pb-date">Apr 28, 2026</div><div className="mp-pb-delta">↑ +18W vs prev test</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">W/kg</div><div className="mp-pb-time">3.2</div><div className="mp-pb-date">Based on 75.4kg</div><div className="mp-pb-delta">↑ +0.2 vs prev</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">Max power</div><div className="mp-pb-time">842 W</div><div className="mp-pb-date">Apr 14, 2026</div><div className="mp-pb-delta">Peak sprint effort</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">Longest ride</div><div className="mp-pb-time">88 km</div><div className="mp-pb-date">Mar 15, 2026</div><div style={{fontSize:"11px",color:"#9CA3AF",marginTop:"3px"}}>5:20 ride time</div></div>
                    </div>
                  </div>
                  {/* Climbing */}
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🧗 Climbing grades</span></div>
                    <div className="mp-pb-grid">
                      <div className="mp-pb-card"><div className="mp-pb-event">Bouldering</div><div className="mp-pb-time">V5</div><div className="mp-pb-date">May 18, 2026</div><div className="mp-pb-delta">Working V6 next</div></div>
                      <div className="mp-pb-card"><div className="mp-pb-event">Lead</div><div className="mp-pb-time">6b+</div><div className="mp-pb-date">Feb 4, 2026</div><div className="mp-pb-delta">Projecting 6c</div></div>
                    </div>
                  </div>
                </div>
                {/* Right col */}
                <div style={{width:"280px",flexShrink:0,display:"flex",flexDirection:"column",gap:"14px"}}>
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">📊 All-time totals</span></div>
                    <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:"6px"}}>
                      {[
                        ["Total distance","4,820 km"],
                        ["Total time","412 hrs"],
                        ["Elevation gained","48,200 m"],
                        ["Calories burned","142,400"],
                        ["Total activities","312"],
                      ].map(([l,v])=>(
                        <div key={l} className="mp-total-row"><span className="mp-total-label">{l}</span><span className="mp-total-val">{v}</span></div>
                      ))}
                    </div>
                  </div>
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">🎯 Goals</span>
                      <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>setModal("goal")}>+ Add</button>
                    </div>
                    <div style={{padding:"14px 18px",display:"flex",flexDirection:"column",gap:"12px"}}>
                      {[
                        {label:"Sub-3:30 marathon",date:"Oct 2026",dateColor:"#F97316",pct:62,barColor:"#F97316",sub:"Current PB: 1:54 HM → projected ~3:52 full"},
                        {label:"FTP 260W",date:"Aug 2026",dateColor:"#3B82F6",pct:93,barColor:"#3B82F6",sub:"Current: 241W · 19W to go"},
                        {label:"V6 bouldering",date:"Jul 2026",dateColor:"#8B5CF6",pct:75,barColor:"#8B5CF6",sub:"Projecting V6 compression problem"},
                      ].map(g=>(
                        <div key={g.label}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",marginBottom:"5px"}}>
                            <span style={{fontWeight:600,color:"var(--gray-900)"}}>{g.label}</span>
                            <span style={{color:g.dateColor,fontFamily:"var(--mono)"}}>{g.date}</span>
                          </div>
                          <div className="mp-goal-bar-wrap"><div className="mp-goal-bar-fill" style={{width:`${g.pct}%`,background:g.barColor}} /></div>
                          <div style={{fontSize:"11px",color:"#6B7280",marginTop:"3px"}}>{g.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════════ ACHIEVEMENTS ════════ */}
          {tab === "achievements" && (
            <div className="mp-content-wrap">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px"}}>
                <div>
                  <h2 style={{fontSize:"17px",fontWeight:700,color:"var(--gray-900)"}}>Achievements</h2>
                  <p style={{fontSize:"13px",color:"#6B7280"}}>18 earned · 14 locked · 6,440 points total</p>
                </div>
              </div>
              <div className="mp-ach-grid">
                {[
                  {icon:"🏃",name:"First 10km",desc:"Complete your first 10km activity",date:"Jan 4, 2026",tier:"gold",locked:false},
                  {icon:"🔥",name:"7-day streak",desc:"Log activities 7 days in a row",date:"Feb 12, 2026",tier:"gold",locked:false},
                  {icon:"🚴",name:"Century rider",desc:"Log 100km of cycling in a week",date:"Mar 15, 2026",tier:"gold",locked:false},
                  {icon:"🧗",name:"V4 climber",desc:"Send your first V4 boulder problem",date:"Mar 28, 2026",tier:"silver",locked:false},
                  {icon:"⚡",name:"Challenge finisher",desc:"Complete your first club challenge",date:"Apr 30, 2026",tier:"silver",locked:false},
                  {icon:"🤝",name:"Club member",desc:"Join your first club on Arenas",date:"Apr 2, 2026",tier:"bronze",locked:false},
                  {icon:"📅",name:"Event starter",desc:"Register for your first event through Arenas",date:"Apr 5, 2026",tier:"gold",locked:false},
                  {icon:"✦",name:"AI coached ×50",desc:"Receive 50 AI coach analyses",date:"May 10, 2026",tier:"silver",locked:false},
                  {icon:"🏅",name:"Podium finisher",desc:"Reach the top 3 on a club leaderboard",date:"Apr 28, 2026",tier:"gold",locked:false},
                  {icon:"🏃",name:"Half marathon PB",desc:"Beat your half marathon personal best",date:"In progress",tier:"silver",locked:true},
                  {icon:"🔥",name:"30-day streak",desc:"Log activities 30 days in a row",date:"Best: 14 days",tier:"gold",locked:true},
                  {icon:"🏔️",name:"Everest climber",desc:"Accumulate 8,848m of elevation",date:"48,200m total",tier:"gold",locked:true},
                ].map(a=>(
                  <div key={a.name} className={`mp-ach-card ${a.tier}${a.locked?" locked":""}`}>
                    <span className="mp-ach-icon">{a.icon}</span>
                    <div className="mp-ach-name">{a.name}</div>
                    <div className="mp-ach-desc">{a.desc}</div>
                    <div className="mp-ach-date" style={{color:a.locked&&a.date==="In progress"?"#F97316":undefined}}>{a.date}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ════════ CLUBS ════════ */}
          {tab === "clubs" && (
            <div className="mp-content-wrap">
              <div style={{marginBottom:"16px"}}>
                <h2 style={{fontSize:"17px",fontWeight:700,color:"var(--gray-900)"}}>My clubs</h2>
                <p style={{fontSize:"13px",color:"#6B7280"}}>1 active club · Find more in the Athletes directory</p>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"10px",maxWidth:"600px"}}>
                <div className="mp-club-card">
                  <div className="mp-club-icon" style={{background:"#FFF7ED"}}>🏃</div>
                  <div style={{flex:1}}>
                    <div className="mp-club-name">Hackney Running Club</div>
                    <div className="mp-club-meta">London · 48 members · Running · Club Pro</div>
                    <div style={{display:"flex",gap:"5px",marginTop:"6px",flexWrap:"wrap"}}>
                      <span className="mp-pill mp-pill-run">Running</span>
                      <span className="mp-pill mp-pill-gray">Member</span>
                      <span className="mp-pill mp-pill-new">Joined Apr 2026</span>
                    </div>
                  </div>
                  <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>showToast("Opening club view…")}>Open →</button>
                </div>
                <div className="mp-discover" onClick={()=>showToast("Opening club search…")}>
                  <div style={{fontSize:"28px",marginBottom:"10px"}}>🔍</div>
                  <div style={{fontSize:"14px",fontWeight:600,color:"#374151",marginBottom:"4px"}}>Find clubs near you</div>
                  <div style={{fontSize:"12px",color:"#6B7280"}}>Search running clubs, cycling teams, climbing gyms and more in your area</div>
                </div>
              </div>
            </div>
          )}

          {/* ════════ FOLLOWING ════════ */}
          {tab === "following" && (
            <div className="mp-content-wrap">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexWrap:"wrap",gap:"10px"}}>
                <div>
                  <h2 style={{fontSize:"17px",fontWeight:700,color:"var(--gray-900)"}}>{followMode==="following"?"Following":"Followers"}</h2>
                  <p style={{fontSize:"13px",color:"#6B7280"}}>89 following · 142 followers</p>
                </div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button className="mp-btn mp-btn-ghost mp-btn-sm" style={{background:followMode==="following"?"var(--gray-100)":undefined}} onClick={()=>setFollowMode("following")}>Following (89)</button>
                  <button className="mp-btn mp-btn-ghost mp-btn-sm" style={{background:followMode==="followers"?"var(--gray-100)":undefined}} onClick={()=>setFollowMode("followers")}>Followers (142)</button>
                </div>
              </div>
              <div className="mp-card">
                <div className="mp-follow-grid">
                  {(followMode==="following"?FOLLOWING:FOLLOWERS).map(f=>(
                    <div key={f.name} className="mp-follow-card">
                      <div className="mp-fc-av" style={{background:f.bg,color:f.fg}}>{f.init}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="mp-fc-name">{f.name}</div>
                        <div className="mp-fc-sport">{f.sport}</div>
                        <div className="mp-fc-streak">{f.streak}</div>
                      </div>
                      <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>toggleFollow(f.name)}>
                        {followMode==="following" ? (followState[f.name] ? "Follow" : "Following") : (followState[f.name] ? "Following" : "Follow")}
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{padding:"10px 18px",borderTop:"1px solid var(--gray-200)",textAlign:"center"}}>
                  <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>showToast("Loading more…")}>
                    {followMode==="following"?"Load all 89":"Load all 142"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ════════ SETTINGS ════════ */}
          {tab === "settings" && (
            <div className="mp-content-wrap">
              <div style={{display:"flex",gap:"20px",alignItems:"start",flexWrap:"wrap"}}>
                {/* Left */}
                <div style={{flex:1,minWidth:"300px",display:"flex",flexDirection:"column",gap:"14px"}}>
                  <div className="mp-card">
                    <div className="mp-card-hdr">
                      <span className="mp-card-title">👤 Profile information</span>
                      <button className="mp-btn mp-btn-yellow mp-btn-sm" onClick={()=>showToast("✓ Profile saved!")}>Save changes</button>
                    </div>
                    <div className="mp-settings-sec">
                      <div className="mp-form-row">
                        <div className="mp-form-field"><label className="mp-form-label">First name</label><input className="mp-form-input" defaultValue="Jamie" /></div>
                        <div className="mp-form-field"><label className="mp-form-label">Last name</label><input className="mp-form-input" defaultValue="King" /></div>
                      </div>
                      <div className="mp-form-field">
                        <label className="mp-form-label">Handle</label>
                        <input className="mp-form-input" defaultValue="@jamiek" />
                        <div className="mp-form-hint">arenas.io/athletes/jamiek</div>
                      </div>
                      <div className="mp-form-field">
                        <label className="mp-form-label">Bio</label>
                        <textarea className="mp-form-textarea" defaultValue="Marathon runner, weekend cyclist, occasional wall climber. Chasing a sub-3:30 marathon. Hackney RC member since 2024." />
                      </div>
                      <div className="mp-form-row">
                        <div className="mp-form-field"><label className="mp-form-label">City</label><input className="mp-form-input" defaultValue="London" /></div>
                        <div className="mp-form-field"><label className="mp-form-label">Country</label>
                          <select className="mp-form-select"><option>United Kingdom</option><option>United States</option><option>Germany</option></select>
                        </div>
                      </div>
                    </div>
                    <div className="mp-settings-sec">
                      <div className="mp-ss-title">Sports & level</div>
                      <div className="mp-form-field">
                        <label className="mp-form-label">Your sports</label>
                        <div className="mp-sport-chips">
                          {Object.entries(sportChips).map(([k,on])=>{
                            const labels: Record<string,string> = {running:"🏃 Running",cycling:"🚴 Cycling",climbing:"🧗 Climbing",swimming:"🏊 Swimming",football:"⚽ Football",weightlifting:"🏋️ Weightlifting",tennis:"🎾 Tennis",surfing:"🏄 Surfing"};
                            return <button key={k} className={`mp-sport-chip${on?" on":""}`} onClick={()=>setSportChips(p=>({...p,[k]:!p[k]}))}>{labels[k]}</button>;
                          })}
                        </div>
                      </div>
                      <div className="mp-form-field" style={{marginTop:"10px"}}>
                        <label className="mp-form-label">Experience level</label>
                        <select className="mp-form-select"><option>Beginner</option><option>Intermediate</option><option selected>Advanced</option><option>Elite / Professional</option></select>
                      </div>
                    </div>
                  </div>
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🔗 Connected accounts</span></div>
                    <div className="mp-settings-sec">
                      {[
                        {icon:"🔶",name:"Strava",status:"✓ Connected · syncing automatically",statusColor:"#10B981",btn:"Disconnect",action:()=>showToast("Disconnecting Strava…"),btnCls:"mp-btn-ghost"},
                        {icon:"⌚",name:"Garmin Connect",status:"Not connected",statusColor:"#9CA3AF",btn:"Connect",action:()=>showToast("Connecting Garmin…"),btnCls:"mp-btn-primary"},
                        {icon:"🍎",name:"Apple Health",status:"Not connected",statusColor:"#9CA3AF",btn:"Connect",action:()=>showToast("Opening Apple Health…"),btnCls:"mp-btn-primary"},
                        {icon:"🌀",name:"Wahoo",status:"Not connected",statusColor:"#9CA3AF",btn:"Connect",action:()=>showToast("Connecting Wahoo…"),btnCls:"mp-btn-primary"},
                      ].map(r=>(
                        <div key={r.name} className="mp-int-row">
                          <div className="mp-ir-left">
                            <span className="mp-ir-icon">{r.icon}</span>
                            <div>
                              <div className="mp-ir-name">{r.name}</div>
                              <div className="mp-ir-status" style={{color:r.statusColor}}>{r.status}</div>
                            </div>
                          </div>
                          <button className={`mp-btn mp-btn-sm ${r.btnCls}`} onClick={r.action}>{r.btn}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {/* Right */}
                <div style={{width:"280px",flexShrink:0,display:"flex",flexDirection:"column",gap:"14px"}}>
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🔒 Privacy</span></div>
                    <div className="mp-settings-sec">
                      {[
                        {key:"pub",label:"Public profile",sub:"Anyone can see your profile and activities"},
                        {key:"lb",label:"Show on leaderboards",sub:"Appear in public and club rankings"},
                        {key:"gps",label:"Share GPS routes",sub:"Show map and route on activities"},
                        {key:"feed",label:"Activity feed visible",sub:"Followers can see your activities"},
                        {key:"dm",label:"Allow direct messages",sub:"From athletes you don't follow"},
                      ].map(r=>(
                        <div key={r.key} className="mp-toggle-row">
                          <div><div className="mp-pr-text">{r.label}</div><div className="mp-pr-sub">{r.sub}</div></div>
                          <button className={`mp-toggle ${toggles[r.key]?"on":"off"}`} onClick={()=>toggleToggle(r.key)} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">🔔 Notifications</span></div>
                    <div className="mp-settings-sec">
                      {[
                        {key:"kudosN",label:"Kudos on activities"},
                        {key:"comments",label:"Comments"},
                        {key:"followers",label:"New followers"},
                        {key:"challenges",label:"Challenge updates"},
                        {key:"events",label:"Club event invites"},
                        {key:"aiSummary",label:"Weekly AI training summary"},
                      ].map(r=>(
                        <div key={r.key} className="mp-toggle-row">
                          <div className="mp-pr-text">{r.label}</div>
                          <button className={`mp-toggle ${toggles[r.key]?"on":"off"}`} onClick={()=>toggleToggle(r.key)} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mp-card">
                    <div className="mp-card-hdr"><span className="mp-card-title">💳 Plan</span></div>
                    <div style={{padding:"14px 18px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:"#FFF9E0",border:"1px solid #fde68a",borderRadius:"8px",marginBottom:"12px"}}>
                        <div style={{fontSize:"20px"}}>✦</div>
                        <div>
                          <div style={{fontSize:"13px",fontWeight:700,color:"var(--gray-900)"}}>Arenas Pro</div>
                          <div style={{fontSize:"11px",color:"#7a5c00"}}>Unlimited AI coaching · $9/month</div>
                        </div>
                      </div>
                      <div style={{fontSize:"12px",color:"#6B7280",marginBottom:"10px"}}>Next billing: Jun 15, 2026 · $9.00</div>
                      <button className="mp-btn mp-btn-ghost mp-btn-full" onClick={()=>showToast("Opening billing portal…")}>Manage billing</button>
                    </div>
                  </div>
                  <div className="mp-danger">
                    <div className="mp-dz-title">Danger zone</div>
                    <div className="mp-dz-sub">These actions are permanent and cannot be undone.</div>
                    <div style={{display:"flex",flexDirection:"column",gap:"7px"}}>
                      <button className="mp-btn mp-btn-ghost mp-btn-full mp-btn-sm" onClick={()=>showToast("Export started — you'll receive an email within 24h")}>📥 Export my data</button>
                      <button className="mp-btn mp-btn-red mp-btn-full mp-btn-sm" onClick={()=>showToast("Contact support to delete your account")}>🗑 Delete account</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ════════ MODALS ════════ */}
      {modal && (
        <div className="mp-overlay" onClick={(e)=>{ if(e.target===e.currentTarget) setModal(null); }}>

          {modal === "edit-profile" && (
            <div className="mp-modal">
              <div className="mp-modal-hdr">
                <div className="mp-modal-title">Edit profile</div>
                <button className="mp-modal-close" onClick={()=>setModal(null)}>✕</button>
              </div>
              <div className="mp-modal-body">
                <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px",background:"var(--gray-50)",borderRadius:"8px"}}>
                  <div style={{width:"56px",height:"56px",borderRadius:"50%",background:"var(--yellow)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px",fontWeight:700,color:"var(--gray-900)"}}>JK</div>
                  <button className="mp-btn mp-btn-ghost mp-btn-sm" onClick={()=>showToast("Photo upload coming soon")}>Change photo</button>
                </div>
                <div className="mp-form-row">
                  <div className="mp-form-field"><label className="mp-form-label">First name</label><input className="mp-form-input" defaultValue="Jamie" /></div>
                  <div className="mp-form-field"><label className="mp-form-label">Last name</label><input className="mp-form-input" defaultValue="King" /></div>
                </div>
                <div className="mp-form-field"><label className="mp-form-label">Bio</label><textarea className="mp-form-textarea" defaultValue="Marathon runner, weekend cyclist, occasional wall climber. Chasing a sub-3:30 marathon. Hackney RC member since 2024." /></div>
                <div className="mp-form-row">
                  <div className="mp-form-field"><label className="mp-form-label">City</label><input className="mp-form-input" defaultValue="London" /></div>
                  <div className="mp-form-field"><label className="mp-form-label">Level</label><select className="mp-form-select"><option>Intermediate</option><option selected>Advanced</option><option>Elite</option></select></div>
                </div>
              </div>
              <div className="mp-modal-footer">
                <button className="mp-btn mp-btn-yellow" style={{flex:1,justifyContent:"center"}} onClick={()=>{setModal(null);showToast("✓ Profile updated!");}}>Save changes</button>
                <button className="mp-btn mp-btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              </div>
            </div>
          )}

          {modal === "comment" && (
            <div className="mp-modal">
              <div className="mp-modal-hdr">
                <div className="mp-modal-title">Comments</div>
                <button className="mp-modal-close" onClick={()=>setModal(null)}>✕</button>
              </div>
              <div className="mp-modal-body">
                <div style={{display:"flex",gap:"9px"}}>
                  <div style={{width:"28px",height:"28px",borderRadius:"50%",background:"#FEF9C3",color:"#854D0E",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",fontWeight:600,flexShrink:0}}>SL</div>
                  <div style={{background:"var(--gray-50)",borderRadius:"0 10px 10px 10px",padding:"9px 12px",fontSize:"13px",color:"#374151"}}>Great effort Jamie! What's your fuelling strategy on long runs?</div>
                </div>
                <div style={{display:"flex",gap:"9px"}}>
                  <div style={{width:"28px",height:"28px",borderRadius:"50%",background:"#FFF7ED",color:"#9A3412",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",fontWeight:600,flexShrink:0}}>JK</div>
                  <div style={{background:"#FFF9E0",borderRadius:"10px 10px 10px 0",padding:"9px 12px",fontSize:"13px",color:"#374151"}}>Thanks Sofia! Gel at km 8 and 16. Trying caffeine this Sunday.</div>
                </div>
                <div style={{display:"flex",gap:"9px",marginTop:"4px"}}>
                  <div style={{width:"28px",height:"28px",borderRadius:"50%",background:"var(--yellow)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",fontWeight:600,color:"var(--gray-900)",flexShrink:0}}>JK</div>
                  <input type="text" placeholder="Add a comment…" style={{flex:1,padding:"8px 12px",border:"1px solid var(--gray-200)",borderRadius:"20px",fontSize:"13px",outline:"none",fontFamily:"var(--font)"}} />
                </div>
              </div>
              <div className="mp-modal-footer">
                <button className="mp-btn mp-btn-primary" style={{flex:1,justifyContent:"center"}} onClick={()=>{setModal(null);showToast("Comment posted!");}}>Post</button>
                <button className="mp-btn mp-btn-ghost" onClick={()=>setModal(null)}>Close</button>
              </div>
            </div>
          )}

          {modal === "avatar" && (
            <div className="mp-modal">
              <div className="mp-modal-hdr">
                <div className="mp-modal-title">Profile photo</div>
                <button className="mp-modal-close" onClick={()=>setModal(null)}>✕</button>
              </div>
              <div className="mp-modal-body">
                <div style={{border:"2px dashed var(--gray-200)",borderRadius:"12px",padding:"32px",textAlign:"center",cursor:"pointer",background:"var(--gray-50)"}} onClick={()=>showToast("File picker opening…")}>
                  <div style={{fontSize:"36px",marginBottom:"10px"}}>📸</div>
                  <div style={{fontSize:"14px",fontWeight:600,color:"var(--gray-900)",marginBottom:"4px"}}>Upload a photo</div>
                  <div style={{fontSize:"12px",color:"#6B7280"}}>PNG or JPG · Max 5MB · Square recommended</div>
                </div>
              </div>
              <div className="mp-modal-footer">
                <button className="mp-btn mp-btn-yellow" style={{flex:1,justifyContent:"center"}} onClick={()=>{setModal(null);showToast("✓ Photo updated!");}}>Save photo</button>
                <button className="mp-btn mp-btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              </div>
            </div>
          )}

          {modal === "goal" && (
            <div className="mp-modal">
              <div className="mp-modal-hdr">
                <div className="mp-modal-title">Add goal</div>
                <button className="mp-modal-close" onClick={()=>setModal(null)}>✕</button>
              </div>
              <div className="mp-modal-body">
                <div className="mp-form-field"><label className="mp-form-label">Goal title</label><input className="mp-form-input" placeholder="e.g. Sub-3:30 marathon" /></div>
                <div className="mp-form-field"><label className="mp-form-label">Sport</label><select className="mp-form-select"><option>Running</option><option>Cycling</option><option>Climbing</option></select></div>
                <div className="mp-form-field"><label className="mp-form-label">Target date</label><input className="mp-form-input" type="date" /></div>
                <div className="mp-form-field"><label className="mp-form-label">Notes</label><textarea className="mp-form-textarea" placeholder="What does hitting this goal mean to you?" /></div>
              </div>
              <div className="mp-modal-footer">
                <button className="mp-btn mp-btn-yellow" style={{flex:1,justifyContent:"center"}} onClick={()=>{setModal(null);showToast("✓ Goal added!");}}>Save goal</button>
                <button className="mp-btn mp-btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TOAST ── */}
      <div className={`mp-toast${toastVisible?" show":""}`}>{toast}</div>
    </>
  );
}

/* ─── ACTIVITY CARD SUB-COMPONENT ──────────────────────────────────── */
interface ACStat { v: string; l: string; }
interface ACProps {
  id: string;
  title: string;
  time: string;
  sport: string;
  sportBg: string;
  sportColor: string;
  sportBorder: string;
  avBg: string;
  avColor: string;
  stats: ACStat[];
  desc?: string;
  ai?: string;
  kudosCount: number;
  isLiked: boolean;
  onKudos: () => void;
  onComment: () => void;
  onShare: () => void;
  showEdit?: boolean;
  onEdit?: () => void;
  bordered?: boolean;
  style?: React.CSSProperties;
}

function ActivityCard({ id,title,time,sport,sportBg,sportColor,sportBorder,avBg,avColor,stats,desc,ai,kudosCount,isLiked,onKudos,onComment,onShare,showEdit,onEdit,style }: ACProps) {
  return (
    <div className="mp-ac" style={style} data-testid={`activity-card-${id}`}>
      <div className="mp-ac-body">
        <div className="mp-ac-head">
          <div style={{width:"32px",height:"32px",borderRadius:"50%",background:avBg,color:avColor,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:600,flexShrink:0}}>JK</div>
          <div>
            <div style={{fontSize:"13px",fontWeight:600,color:"var(--gray-900)"}}>{title}</div>
            <div style={{fontSize:"11px",color:"#9CA3AF"}}>{time}</div>
          </div>
          <div className="mp-ac-sport-tag" style={{background:sportBg,color:sportColor,border:`1px solid ${sportBorder}`}}>{sport}</div>
        </div>
        <div className="mp-ac-stats">
          {stats.map(s=>(
            <div key={s.l} className="mp-ac-stat"><div className="sv">{s.v}</div><div className="sl">{s.l}</div></div>
          ))}
        </div>
        {desc && <div className="mp-ac-desc">{desc}</div>}
        {ai && (
          <div className="mp-ac-ai">
            <div className="mp-ai-icon">AI</div>
            <div className="mp-ac-ai-text"><strong>AI Coach:</strong> {ai}</div>
          </div>
        )}
      </div>
      <div className="mp-ac-footer">
        <button className={`mp-ac-action${isLiked?" liked":""}`} onClick={onKudos} data-testid={`btn-kudos-${id}`}>👍 {kudosCount} kudos</button>
        <button className="mp-ac-action" onClick={onComment} data-testid={`btn-comment-${id}`}>💬 Comments</button>
        <button className="mp-ac-action" onClick={onShare}>🔗 Share</button>
        {showEdit && <button className="mp-ac-action" onClick={onEdit}>✏️ Edit</button>}
        {ai && <span style={{marginLeft:"auto",fontSize:"11px",color:"#9CA3AF"}}>✦ AI analysed</span>}
      </div>
    </div>
  );
}
