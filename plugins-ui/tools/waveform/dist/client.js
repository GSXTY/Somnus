/**
 * Somnus 业务工具插件客户端模块（波形分析）。
 * 由 build.mjs 自动生成，请勿手改；重新构建：node build.mjs
 *
 * 渲染代码就是原内置工具页源码（已从 desktop/dsh_next/client/ 移入 src/，由插件自带）：
 *   页面组件复用仓库源码：波形分析。
 */
window.__ModuleLoader__.load({
  id: '@local/somnus-tool-waveform',
  factory(require) {
    var React = require('react');
    var module = { exports: {} };
    var exports = module.exports;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/entry.tsx
    var entry_exports = {};
    __export(entry_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(entry_exports);

    // ../../../desktop/dsh_next/client/NativeWaveform.tsx
    var import_react = require("react");

    // ../../../page_design/frontend/src/shared/nativeFetch.mjs
    async function nativeFetch(path, init = {}) {
      const bridge = globalThis.window?.somnusApi;
      if (!bridge?.request) return fetch(path, init);
      if (typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("//")) {
        throw new Error("Invalid domain API path");
      }
      init.signal?.throwIfAborted();
      const headers = new Headers(init.headers);
      let body = init.body;
      if (body instanceof Blob) body = await body.arrayBuffer();
      if (body instanceof FormData) {
        const encoded = new Response(body);
        headers.set("Content-Type", encoded.headers.get("Content-Type"));
        body = await encoded.arrayBuffer();
      }
      init.signal?.throwIfAborted();
      const reply = await bridge.request(path, { method: init.method || "GET", headers: Object.fromEntries(headers), body });
      init.signal?.throwIfAborted();
      return new Response(reply.status === 204 || reply.status === 205 || reply.status === 304 ? null : reply.body, {
        status: reply.status,
        headers: reply.headers
      });
    }

    // somnus-waveform:D:\VVFLY\SomnusNext\event_detection\index.html
    var event_detection_default = `<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\u6CE2\u5F62\u5206\u6790 \xB7 Somnus</title>
    <link rel="stylesheet" href="/ui/bootstrap.min.css">
    <style>
    *{box-sizing:border-box}body{margin:0;background:#f7efe4;color:#4d342b;font:14px 'Microsoft YaHei',sans-serif}header{background:#3a2b24;color:white;padding:20px 28px;display:flex;align-items:center;justify-content:space-between}h1{font-size:21px;margin:0 0 5px}header small{color:#abc3d7}button,.file{border:1px solid #e3d2c1;background:white;color:#4d342b;padding:8px 14px;border-radius:6px;cursor:pointer;font:inherit}.file{background:#9e553f;color:white;border:0}main{max-width:1800px;margin:auto;padding:20px 28px}.info{display:flex;gap:26px;flex-wrap:wrap;margin-bottom:12px}.note{background:#fff6dc;padding:11px 15px;border-radius:6px;color:#775b1c;margin:12px 0;line-height:1.7}.toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:16px 0}input[type=time],input[type=number]{padding:7px;border:1px solid #e3d2c1;border-radius:5px}#channels{display:flex;gap:13px;flex-wrap:wrap;background:white;padding:12px;border-radius:7px;margin-bottom:12px}label{cursor:pointer}section{background:white;border:1px solid #efdfd0;border-radius:8px;overflow:hidden;margin-bottom:12px}.title{padding:10px 15px;font-weight:bold;display:flex;justify-content:space-between}.value{font-weight:normal;color:#9e553f}canvas{display:block;width:100%;height:180px;touch-action:none;cursor:crosshair}#overview{height:88px;cursor:crosshair}#status{color:#6b5445;min-height:24px}#error{color:#b4452f;white-space:pre-wrap}.foot{color:#60758a;margin:14px 0;line-height:1.8}#range{margin-left:auto;color:#6b5445}button:disabled{opacity:.5;cursor:wait}
    .wave-wrap{position:relative;height:180px}.cursor-layer{position:absolute;inset:0}
    .group-title{align-items:center;gap:10px;flex-wrap:wrap}.legend{display:flex;flex-wrap:wrap;gap:8px}.channel-chip{display:flex;align-items:center;gap:5px;background:#fbf2e9;border:1px solid #f0e2d4;border-radius:6px;padding:5px 8px}.channel-handle{cursor:grab;user-select:none}.channel-handle:active{cursor:grabbing}.channel-chip select{max-width:145px;border:1px solid #d5dfe9;border-radius:4px;background:white;color:#52677b;padding:3px;font:12px 'Microsoft YaHei'}.channel-chip button{padding:3px 6px;font-size:12px}.axis-note{font-weight:normal;font-size:12px;color:#71859a}.group-value{display:flex;gap:14px;flex-wrap:wrap;padding:0 15px;min-height:22px;font-size:12px}.merged .wave-wrap,.merged canvas{height:240px}.drop-target{outline:3px solid #9e553f;outline-offset:-3px;background:#effbfa}.channel-dragging .wave-panel{border-style:dashed}.overlay-help{color:#546d80;line-height:1.8;margin:12px 0}
    body[data-mode=engineering] .merged .wave-wrap,body[data-mode=engineering] .merged canvas{height:420px}
    main{max-width:none;padding:18px 20px}.workspace{display:grid;grid-template-columns:235px minmax(0,1fr) 340px;gap:18px;align-items:start}.chart-area{min-width:0}.channel-sidebar{position:sticky;top:16px;background:white;border:1px solid #efdfd0;border-radius:8px;overflow:hidden}.sidebar-head{padding:15px 14px 10px;display:flex;align-items:center;justify-content:space-between}.sidebar-head strong{font-size:15px}.sidebar-head small{color:#8d756b}.sidebar-tools{padding:0 12px 10px;display:flex;gap:7px;flex-wrap:wrap}.sidebar-tools input[type=search]{width:100%;padding:9px;border:1px solid #ecdccd;border-radius:5px;font:inherit}.sidebar-tools button{font-size:12px;padding:5px 8px}.sidebar-tools label{font-size:12px;display:flex;align-items:center;gap:3px;color:#5b7185}#channels{display:block;padding:5px 8px;margin:0;border-radius:0;max-height:calc(100vh - 325px);min-height:150px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;border-top:1px solid #f2e8dd}#channels label{display:flex;gap:8px;align-items:flex-start;padding:9px 7px;border-radius:5px;line-height:1.5;overflow-wrap:anywhere}#channels label:hover{background:#fbf2e9}#channels label:has(input:checked){background:#f7e9dc;color:#8a4a36}#channels input{margin-top:4px;accent-color:#9e553f;flex-shrink:0}#channels label[hidden]{display:none}.sidebar-empty{padding:12px;color:#a08c7d;font-size:12px}.sidebar-foot{padding:11px 14px;color:#94806f;font-size:12px;border-top:1px solid #f2e8dd;line-height:1.6}.chart-area>.note{margin-top:0}.chart-area>.toolbar:first-of-type{margin-top:10px}.chart-area select#display-mode{max-width:100%;padding:7px;border:1px solid #e3d2c1;border-radius:5px;background:white}.info{font-size:12px;gap:15px}.sidebar-tools input:focus{outline:2px solid #8fc4cc;outline-offset:1px}
    @media(max-width:1000px){.workspace{grid-template-columns:190px minmax(0,1fr);gap:12px}main{padding:12px}.sidebar-head{padding:12px 10px}.sidebar-tools{padding:0 8px 8px}.channel-chip select{max-width:100px}}
    @media(max-width:580px){.workspace{grid-template-columns:145px minmax(0,1fr);gap:8px}main{padding:8px}header{padding:14px}.sidebar-head{display:block}.sidebar-tools label{font-size:11px}#channels label{font-size:12px;padding:7px 3px}.toolbar{gap:5px}.toolbar button{padding:6px 8px}.sidebar-foot{padding:8px}.sidebar-tools button{padding:4px}.axis-note{display:none}}
    .annotation-toolbar{padding:12px;border:1px solid #ecdccd;border-radius:7px;background:#fbf3ea;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.annotation-toolbar button[aria-pressed=true]{background:#9e553f;color:white}.annotation-toolbar small{color:#7d6a5f}.event-list{max-height:270px;overflow:auto;padding:0 12px}.event-row{padding:10px 0;border-bottom:1px solid #e5edf2;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.event-row .event-text{flex:1;min-width:150px;overflow-wrap:anywhere}.event-row small{display:block;color:#708497}.event-row button{font-size:12px;padding:5px 8px}.event-actions{display:flex;gap:7px;flex-wrap:wrap;padding:10px 12px}.event-summary{font-size:12px;color:#7d6a5f;padding:0 12px 12px}.annotation-dialog{width:min(540px,95vw);border:1px solid #cfdae4;border-radius:9px;padding:22px;color:#4d342b}.annotation-dialog::backdrop{background:#12283c66}.annotation-dialog h2{font-size:18px;margin:0 0 15px}.annotation-dialog label{display:block;margin:12px 0 5px}.annotation-dialog input,.annotation-dialog select,.annotation-dialog textarea{width:100%;padding:8px;border:1px solid #e3d2c1;border-radius:5px;font:inherit}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.event-message{color:#ac402c;font-size:12px;line-height:1.7}
    .event-type-options{display:flex;flex-wrap:wrap;gap:9px 16px;max-height:140px;overflow:auto;padding:9px 0}.event-type-options label{display:flex;align-items:center;gap:5px;font-size:13px}.event-type-options input{accent-color:#9e553f}.event-type-picker{width:100%;padding:8px 12px;border:1px solid #d9e5ec;border-radius:6px;background:#fffdf8}.event-type-picker summary{cursor:pointer;color:#5a4235}.event-type-picker fieldset{border:0;padding:6px 0 0;margin:0}.event-type-picker button{font-size:12px;padding:5px 9px}.event-type-picker small{display:block;color:#8d756b;padding-top:5px}.scan-history-dialog{width:min(1000px,96vw);max-height:90vh}.history-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.scan-history-dialog .history-tools input{width:min(400px,100%)}.scan-history-dialog .history-tools select{width:auto}.history-list{max-height:52vh;overflow:auto;margin:12px 0}.history-row{padding:12px 2px;border-bottom:1px solid #f0e2d4;display:flex;flex-wrap:wrap;align-items:center;gap:8px}.history-row p{width:100%;margin:0 0 5px;line-height:1.6;overflow-wrap:anywhere}.scan-history-dialog .history-row input{width:min(360px,100%)}.history-row button{font-size:12px;padding:7px 10px}#feedback-run{max-width:min(670px,75vw)}#feedback-batch-info{color:#657c8e;font-size:12px}.file-library{border-bottom:1px solid #f0e2d4;padding:0 10px 12px}.file-library .sidebar-head{padding-left:2px;padding-right:2px}.file-library>input{width:100%;padding:8px;border:1px solid #d3dfe8;border-radius:5px}#file-list{max-height:190px;overflow:auto;margin:8px 0;display:flex;flex-direction:column;gap:5px}.library-file{text-align:left;overflow-wrap:anywhere;padding:8px;font-size:12px}.library-file[aria-pressed=true]{background:#e5f3f4;color:#086d77;border-color:#9e553f}.file-library>small{display:block;color:#94806f;font-size:11px;line-height:1.6}.library-row{display:flex;gap:4px;align-items:stretch}.library-row .library-file{flex:1;min-width:0}.library-close{flex:0 0 28px;padding:3px;color:#94806f;font-size:19px}.library-close:hover{background:#fff0ef;color:#b4452f}
    /* Constrain the whole sidebar; each list owns its scrolling. */
    .channel-sidebar{display:flex;flex-direction:column;height:var(--sidebar-height,calc(100dvh - 180px));max-height:calc(100dvh - 32px);min-height:0;overflow:hidden}
    .channel-sidebar>.sidebar-head,.channel-sidebar>.sidebar-tools,.sidebar-foot,.sidebar-empty{flex:0 0 auto}
    .file-library{display:flex;flex-direction:column;flex:1 1 auto;max-height:none;min-height:220px;overflow:hidden}
    .file-library>.sidebar-head,.file-library>input,.file-library>small{flex:0 0 auto}
    #file-list{flex:1 1 auto;min-height:0;max-height:190px;overflow-y:auto;overscroll-behavior-y:contain;scrollbar-gutter:stable}
    .library-row{flex-shrink:0}
    #channels{flex:1 1 0;min-height:0;max-height:none;overflow-y:auto;overscroll-behavior-y:contain}
    @media(max-height:600px){.file-library>small,.sidebar-foot{display:none}.file-library{max-height:32dvh}.sidebar-head{padding-top:8px;padding-bottom:6px}}
    .event-actions button[aria-pressed="true"]{background:#9e553f;color:white;border-color:#9e553f}
    /* Screening results scroll independently beside the waveforms. */
    .workspace{grid-template-columns:235px minmax(0,1fr) 360px;gap:16px}
    body.event-panel-collapsed .workspace{grid-template-columns:235px minmax(0,1fr)}
    .event-panel{position:sticky;top:16px;align-self:start;display:flex;flex-direction:column;height:var(--event-panel-height,calc(100dvh - 64px));max-height:calc(100dvh - 32px);min-height:180px;min-width:0;background:white;border:1px solid #ecdccd;border-radius:8px;overflow:hidden}
    .event-panel[hidden],.event-panel-backdrop[hidden]{display:none!important}
    .event-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-bottom:1px solid #f0e2d4;background:#fdf6ee;flex-shrink:0}
    .event-panel-head>div{display:flex;flex-direction:column;gap:5px;min-width:0}
    .event-panel-head #event-count{font-size:12px;color:#8d756b;font-weight:normal}
    .event-panel-head button{font-size:12px;padding:5px 9px;flex-shrink:0}
    .event-panel-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
    .event-panel-body>:not(.event-list){flex-shrink:0}
    .event-panel .event-actions{gap:4px;padding:6px}
    .event-panel .event-actions button,.event-panel .file{padding:4px 6px;font-size:11.5px;min-height:26px;line-height:1.1}
    .event-panel .event-actions[aria-label="\u72EC\u7ACB\u4E8B\u4EF6\u7ED3\u679C"] button{flex:1 1 auto}
    .event-panel select{max-width:100%;font:12px 'Microsoft YaHei',sans-serif;border:1px solid #e3d2c1;border-radius:5px;padding:5px;background:white;color:#4d342b}
    .event-panel .event-status-tools{align-items:center;border-top:1px solid #f2e8dd}
    .event-panel .event-backup{font-size:12px;flex:1}
    .event-panel .event-backup[open]{flex-basis:100%}
    .event-backup summary{cursor:pointer;color:#5a4235;padding:4px}
    .backup-actions{display:flex;flex-wrap:wrap;gap:6px;padding:7px 0}
    .event-panel .event-type-picker{border-radius:0;border-left:0;border-right:0;font-size:12px;padding:7px 9px;max-height:210px;overflow-y:auto}
    .event-panel .event-type-picker label{font-size:11px;line-height:1.5}
    .event-panel .event-summary{padding:7px 10px;font-size:11px;line-height:1.5}
    .event-panel #scan-view-note{padding:0 10px 7px;color:#8d756b;font-size:11px;line-height:1.5}
    .event-panel .event-list{flex:1 1 auto;min-height:180px;max-height:none;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 10px;border-top:1px solid #f0e2d4}
    .event-panel .event-row{align-items:flex-start;padding:12px 0;gap:6px}
    .event-panel .event-row strong{font-size:13px;line-height:1.6}
    .event-panel .event-row small{font-size:11px;line-height:1.55}
    .event-panel .event-row .event-text{flex-basis:100%;min-width:0}
    .event-panel .event-row button{padding:4px 7px;font-size:12px}
    .event-note summary{font-size:11px;color:#8d756b;cursor:pointer;margin:4px 0}
    .event-hints{padding:4px 0;color:#986126!important}
    .event-panel-backdrop{position:fixed;inset:0;border:0;border-radius:0;background:#12283c44;z-index:70}
    @media(max-width:1450px){.workspace{grid-template-columns:200px minmax(0,1fr) 340px;gap:12px}body.event-panel-collapsed .workspace{grid-template-columns:200px minmax(0,1fr)}}
    @media(max-width:1100px){.workspace,body.event-panel-collapsed .workspace{grid-template-columns:190px minmax(0,1fr)}.event-panel{position:fixed;top:12px;right:12px;bottom:12px;width:min(380px,calc(100vw - 24px));height:calc(100dvh - 24px);max-height:none;z-index:80;box-shadow:0 12px 40px #3a2b2433}}
    @media(max-width:580px){.workspace,body.event-panel-collapsed .workspace{grid-template-columns:145px minmax(0,1fr);gap:8px}}

    .event-current-mode{padding:9px 11px;background:#eef7f8;border-bottom:1px solid #deeaed;line-height:1.6}
    .event-current-mode strong{display:block;font-size:12px;color:#8a4a36}
    .event-current-mode small{display:block;color:#647b8d;font-size:11px;margin-top:3px}
    .event-current-mode button{font-size:12px;padding:5px 8px;margin-top:6px}

    /* Persistent fixed-size slots prevent hover values from moving the waveform. */
    .group-value{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));grid-auto-rows:40px;gap:0 14px;min-height:40px;align-content:start;font-variant-numeric:tabular-nums}
    .readout-item{display:block;min-width:0;height:40px;overflow:hidden}
    .readout-text{display:block;line-height:18px;max-height:36px;overflow:hidden;overflow-wrap:anywhere}
    .group-value[data-active=false] .readout-text{visibility:hidden}
    </style><link rel="stylesheet" href="/dashboard.css"><link rel="stylesheet" href="/ui/events.css"></head><body class="events-page">
    <div class="events-global-header"><a class="events-main-brand" href="/"><span class="events-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M12 11v6M9 14h6"/></svg></span><span>Somnus</span></a><span class="events-header-status"><i></i>\u672C\u5730\u6570\u636E\u5206\u6790\u5DE5\u4F5C\u533A</span></div>
    <aside class="sidebar"><a class="brand" href="/" aria-label="\u6570\u636E\u5206\u6790\u5DE5\u4F5C\u53F0\u9996\u9875"><span class="brand-icon">D</span><span>\u6570\u636E\u5206\u6790\u5DE5\u4F5C\u53F0<small>DATA WORKSPACE</small></span></a><div class="nav-label">\u5DE5\u4F5C\u7A7A\u95F4</div><nav aria-label="\u4E3B\u5BFC\u822A"><a class="nav-item" href="/"><span aria-hidden="true">\u25A6</span>\u8FD4\u56DE\u4E3B\u5DE5\u4F5C\u53F0</a><a class="nav-item active" href="/events" aria-current="page"><span aria-hidden="true">\u223F</span>\u6CE2\u5F62\u5206\u6790</a></nav><div class="sidebar-bottom"><span class="local-dot"></span>\u672C\u5730\u6570\u636E\u7A7A\u95F4<p>\u6570\u636E\u5728\u672C\u673A\u5904\u7406\u4E0E\u4FDD\u5B58</p></div></aside><div class="event-shell">
    <header>
      <div class="event-heading">
        <button id="toggle-channels" class="channel-toggle view-toggle" type="button" hidden aria-expanded="true" aria-controls="channel-panel">\u6587\u4EF6\u4E0E\u901A\u9053</button>
        <div><div class="breadcrumb">\u5DE5\u4F5C\u53F0 <span>/</span> \u6CE2\u5F62\u5206\u6790</div><h1>\u6CE2\u5F62\u5206\u6790</h1><small id="app-version">\u672C\u673A\u6570\u636E \xB7 \u591A\u901A\u9053\u8054\u52A8</small><div class="events-back-link-wrap" style="margin-top:8px"><a href="/" class="events-return-link">\u2190 \u8FD4\u56DE\u4E3B\u5DE5\u4F5C\u53F0</a></div></div>
      </div>
      <label class="file">\u6253\u5F00 CSV<input id="file" type="file" accept=".csv" multiple hidden></label>
    </header>
    <main>
    <div class="record-context">
      <div class="info" id="info">\u6B63\u5728\u8BFB\u53D6\u6587\u4EF6\u2026</div>
    </div>
    <div id="error" role="alert"></div>
    <div class="results-switch-row">
      <button id="toggle-events" class="event-toggle view-toggle" type="button" aria-expanded="true" aria-controls="event-panel">\u7B5B\u67E5\u7ED3\u679C</button>
    </div>
    <div class="workspace"><aside id="channel-panel" class="channel-sidebar" aria-label="\u6587\u4EF6\u4E0E\u6570\u636E\u901A\u9053">
    <div class="file-library"><div class="sidebar-head"><strong>\u6587\u4EF6\u5217\u8868</strong><small id="file-library-count">0 \u4EFD</small><button id="close-channel-panel" class="panel-collapse" type="button" hidden aria-label="\u6536\u8D77\u6587\u4EF6\u4E0E\u901A\u9053">\u2212</button></div><input id="file-search" type="search" placeholder="\u641C\u7D22\u6587\u4EF6\u540D\u2026" aria-label="\u641C\u7D22CSV\u6587\u4EF6"><div id="file-list" aria-label="CSV\u6587\u4EF6\u5217\u8868"></div><small>\u53EF\u5728\u5DF2\u6253\u5F00\u7684 CSV \u4E4B\u95F4\u5207\u6362\uFF0C\u5404\u6587\u4EF6\u5355\u72EC\u4FDD\u7559\u67E5\u770B\u4F4D\u7F6E\u3002</small></div><div class="sidebar-head"><strong>\u6570\u636E\u901A\u9053</strong><small id="channel-count">\u52A0\u8F7D\u4E2D</small></div><div class="sidebar-tools"><input id="channel-search" type="search" placeholder="\u641C\u7D22\u901A\u9053\u2026" aria-label="\u641C\u7D22\u901A\u9053"><button id="select-visible">\u5168\u9009\u7ED3\u679C</button><button id="clear-channels">\u6E05\u7A7A\u9009\u62E9</button><label><input id="show-all-channels" type="checkbox" checked>\u663E\u793A\u5168\u90E8\u901A\u9053</label><label><input id="selected-only" type="checkbox">\u4EC5\u770B\u5DF2\u9009</label></div><div id="channels" aria-label="\u901A\u9053\u5217\u8868"></div><div id="channel-empty" class="sidebar-empty" hidden>\u6CA1\u6709\u5339\u914D\u7684\u901A\u9053</div><div class="sidebar-foot">\u9ED8\u8BA4\u5217\u51FA CSV \u7684\u5168\u90E8\u53EF\u7ED8\u5236\u5B57\u6BB5\u3002\u53EA\u6709\u52FE\u9009\u7684\u901A\u9053\u624D\u753B\u5728\u56FE\u4E0A\uFF1B\u62D6\u52A8\u56FE\u4E2D\u540D\u79F0\u53EF\u53E0\u52A0\u3002</div></aside><div class="chart-area">
    <div class="view-tools" role="group" aria-label="\u6CE2\u5F62\u5DE5\u5177">
      <div class="toolbar timeline-toolbar">
        <button id="all" type="button">\u6574\u6BB5</button><button id="in" type="button" aria-label="\u653E\u5927">\uFF0B</button><button id="out" type="button" aria-label="\u7F29\u5C0F">\u2212</button><button id="prev" type="button" aria-label="\u524D\u79FB">\u2190</button><button id="next" type="button" aria-label="\u540E\u79FB">\u2192</button>
        <span id="range"></span>
        <button id="toggle-wave-settings" class="view-toggle" type="button" aria-expanded="false" aria-controls="wave-settings-panel">\u6CE2\u5F62\u8BBE\u7F6E</button>
      </div>
      <div id="wave-settings-panel" class="wave-settings-body" hidden>
        <div class="display-toolbar">
          <label for="display-mode">\u65F6\u95F4\u8F74</label>
          <select id="display-mode" aria-label="\u663E\u793A\u65B9\u5F0F"><option value="raw">\u539F\u59CB\u6570\u636E</option><option value="engineering">\u4FEE\u6B63</option></select>
          <button id="reference-view" type="button">\u538B\u529B\u5BF9\u6BD4\uFF085\u79D2\uFF09</button>
        </div>
        <div class="display-toolbar">
          <label for="time">\u5B9A\u4F4D</label><input id="time" type="time" step="1">
          <label for="window">\u7A97\u53E3\uFF08\u79D2\uFF09</label><input id="window" type="number" min="1" value="60" style="width:72px">
          <button id="go" type="button">\u8DF3\u8F6C</button>
        </div>
        <div class="display-toolbar">
          <button id="merge-all" type="button">\u5168\u90E8\u53E0\u52A0</button><button id="split-all" type="button">\u5168\u90E8\u5206\u5F00</button>
          <label><input id="first-plot-events" type="checkbox" checked> \u5728\u4E3B\u56FE\u663E\u793A\u4E8B\u4EF6</label>
        </div>
        <details id="analysis-notes" class="analysis-notes">
          <summary>\u663E\u793A\u4E0E\u6570\u636E\u8BF4\u660E</summary>
          <div class="note" id="mode-note">\u6B63\u5728\u8BFB\u53D6\u663E\u793A\u8BBE\u7F6E\u2026</div>
        </details>
      </div>
    </div>
    <div class="annotation-toolbar scan-toolbar"><strong>\u4E8B\u4EF6\u7B5B\u67E5</strong><select id="scan-profile" aria-label="\u68C0\u6D4B\u65B9\u6848"><option value="patient_flow_v4">\u60A3\u8005\u6D41\u91CF\uFF1A\u6682\u505C/\u4F4E\u901A\u6C14\uFF08\u4F18\u5316v4\uFF09</option><option value="company_rules">\u9ED8\u8BA4</option><option value="dynamic_baseline_v3" selected>\u52A8\u6001\u57FA\u7EBF</option></select><button id="scan-all">\u7B5B\u67E5\u6574\u4EFD</button><button id="scan-window">\u7B5B\u67E5\u5F53\u524D\u533A\u95F4</button>
    <details id="scan-options" class="scan-options">
    <summary>\u7B5B\u67E5\u53C2\u6570 \xB7 <span id="scan-type-summary">\u5168\u68C0\u6D4B</span></summary>
    <div class="scan-options-body">
    <label id="amplitude-source-label" hidden>\u8F93\u5165\u4FE1\u53F7 <select id="amplitude-source"><option value="csv_flow">CSV\u6D41\u91CF</option><option value="pressure_q">\u538B\u529B\u4F30\u7B97Q</option></select></label><span id="baseline-options" hidden><label>\u68C0\u6D4B\u65B9\u6CD5 <select id="baseline-method" aria-label="\u52A8\u6001\u57FA\u7EBF\u68C0\u6D4B\u65B9\u6CD5"><option value="detrended_abs" hidden disabled>\u53BB\u80CC\u666F\u7EDD\u5BF9\u503C\u5747\u503C\xF72\uFF08\u8BD5\u9A8C\uFF09</option><option value="centered_rms">\u7A97\u53E3\u53BB\u5747\u503CRMS\uFF08\u673A\u5668\u6CE2\u52A8\uFF09</option><option value="absolute_mean">\u7EDD\u5BF9\u503C\u5747\u503C\xF72\uFF08\u672A\u53BB\u80CC\u666F\uFF09</option></select></label> <label>\u68C0\u6D4B\u7A97\u53E3 <select id="baseline-window" aria-label="\u52A8\u6001\u57FA\u7EBF\u68C0\u6D4B\u7A97\u53E3"><option value="1">1\u79D2</option><option value="2">2\u79D2</option><option value="3">3\u79D2</option><option value="4">4\u79D2</option><option value="5">5\u79D2</option><option value="6">6\u79D2</option><option value="7">7\u79D2</option><option value="8" selected>8\u79D2</option><option value="9">9\u79D2</option><option value="10">10\u79D2</option></select></label></span><small id="patient-flow-rule-info" hidden>\u60A3\u8005\u6D41\u91CFv4\uFF1ACSV\u6D41\u91CF\u6309\u7528\u6237\u786E\u8BA4\u7684\u60A3\u8005\u547C\u5438\u6D41\u91CF\uFF08L/min\uFF09\u5206\u6790\uFF1B\u4F7F\u7528\u60A3\u8005\u6D41\u91CF\u7EDD\u5BF9\u503C\u5E45\u5EA6\uFF0C\u7A97\u53E31\uFF5E10\u79D2\uFF08\u9ED8\u8BA45\u79D2\uFF09\uFF0C\u6682\u505C\u4E0E\u4F4E\u901A\u6C14\u4E24\u7C7B\u5019\u9009\u5747\u9700\u539F\u59CB\u6E90\u79D2\u8FDE\u7EED\u8FBE\u6807\u81F3\u5C1110\u79D2\uFF0C\u5E76\u6709\u4E3B\u7A97\u53E3\u652F\u6301\uFF1B\u4E0D\u6309\u4E3B\u7A97\u53E3\u62D6\u5C3E\u5EF6\u957F\u6301\u7EED\u65F6\u95F4\u3002\u4F4E\u901A\u6C14\u5C1A\u672A\u63A5\u5165\u8840\u6C27\u4E0B\u964D\u6216\u89C9\u9192\u8BC1\u636E\uFF0C\u4E0D\u533A\u5206OA/CA\uFF0C\u4E0D\u8F93\u51FA\u4E34\u5E8AAHI\uFF0C\u4E0D\u4FEE\u6539\u8BBE\u5907\u8BBE\u7F6E\u3002</small><small id="optimized-rule-info" hidden>\u4F18\u5316\u6D4B\u8BD5v2\uFF1A\u9ED8\u8BA4\u53BB\u80CC\u666F\u7EDD\u5BF9\u503C\u6CD5\uFF0B5\u79D2\u4E3B\u7A97\u53E3\uFF1B3\u79D2\u9884\u89E6\u53D1\u53EA\u751F\u6210\u9884\u5019\u9009\uFF0C1\u79D2\u6E90\u5206\u7BB1\u8FDE\u7EED\u8FBE\u6807\u226510\u79D2\u5E76\u6709\u4E3B\u7A97\u53E3\u51CF\u5F31\u4F50\u8BC1\u624D\u4FDD\u5B58\u3002\u4F30\u8BA1\u6CE2\u5F62\u533A\u95F4\u3001\u4E3B\u7A97\u53E3\u8FBE\u6807\u533A\u95F4\u548C\u786E\u8BA4\u65F6\u523B\u5206\u5F00\uFF1B\u4E0D\u6309\u7A97\u53E3\u56FA\u5B9A\u524D\u79FB\u300230\u79D2\u56E0\u679C\u80CC\u666F\u3001100\u79D2\u53C2\u8003\uFF0C\u9884\u5019\u9009\u65F6\u51BB\u7ED3\uFF1B\u672A\u6210\u4E8B\u4EF6\u4E14\u8D28\u91CF\u6709\u6548\u7684\u77ED\u6682\u4E0B\u964D\u56DE\u586B\u3002\u2265120\u79D2\u957F\u6BB5\u4FDD\u7559\u5E76\u63D0\u793A\u590D\u6838\uFF1B\u226410%\u4EC5\u4E3A\u5F3A\u5EA6\u6807\u8BB0\u3002\u8F93\u5165\u4ECD\u662F\u673A\u5668\u603B\u6D41\u91CF\uFF0C\u80CC\u666F\u4F30\u8BA1\u4E0D\u662F\u6F0F\u6C14\u6216\u60A3\u8005\u6D41\u91CF\u3002</small><small id="optimized-v3-rule-info" hidden>\u4F18\u5316v3\uFF1A\u9ED8\u8BA4\u53BB\u80CC\u666F\u7EDD\u5BF9\u503C\u6CD5\uFF0B8\u79D2\u4E3B\u7A97\u53E3\u3002\u663E\u8457\u4E0B\u964D\uFF1A1\u79D2\u590D\u6838\u5269\u4F59&lt;25%\u8FDE\u7EED\u8FBE\u6807\u4E14\u6709\u4E3B\u7A97\u53E3\u4F50\u8BC1\uFF0C\u6D41\u91CF\u5C3E\u6BB5\u8BC1\u636E\u5145\u5206\u65F6\u4ECE\u8D8B\u7A33\u540E\u8BA1\u65F6\uFF0C\u518D\u6838\u5BF9\u6700\u77ED\u6301\u7EED\uFF1B\u51CF\u5F31\uFF1A\u6240\u9009\u4E3B\u7A97\u53E3\u5269\u4F59&lt;50%\u8FDE\u7EED\u226510\u79D2\uFF0C\u5C0F\u76841\u79D2\u5CF0\u503C\u4E0D\u518D\u6253\u65AD\u5F31\u4E8B\u4EF6\u3002\u5F31\u4E8B\u4EF6\u4ECE\u4E3B\u7A97\u53E3\u9996\u6B21\u8FBE\u6807\u672B\u7AEF\u8BA1\u65F6\uFF0C\u4E0D\u6309\u7A97\u53E3\u524D\u79FB\u3002\u603B\u6F0F\u6C14\u53D8\u5316\u226510 L/min\u4EC5\u63D0\u793A\u590D\u6838\uFF0C\u4E0D\u6E05\u7A7A\u53C2\u8003\uFF1B\u6570\u636E\u7F3A\u5931\u3001\u65E0\u6548\u6216\u72B6\u6001\u53D8\u5316\u4ECD\u91CD\u7F6E\u3002\u5F00\u5934\u4ECD\u9700\u6709\u6548\u53C2\u8003\uFF0C\u672A\u68C0\u51FA\u4E0D\u7B49\u4E8E\u6B63\u5E38\uFF1B\u4E0D\u662F\u4E34\u5E8A\u5206\u7C7B\u3002</small><small id="baseline-rule-info" hidden>\u52A8\u6001\u57FA\u7EBF\u68C0\u6D4B\uFF1ACSV\u673A\u5668\u603B\u6D41\u91CF\uFF0C\u524D100\u79D2\u81F3\u5C1130\u79D2\u6709\u6548\u53C2\u8003\uFF1B\u9996\u6B21\u5269\u4F59&lt;50%\u5373\u51BB\u7ED3\u3002\u5269\u4F59&lt;25%\u8FDE\u7EED\u226510\u79D2\u4E3A\u663E\u8457\u4E0B\u964D\u5019\u9009\uFF0C\u5426\u5219\u5269\u4F59&lt;50%\u7684\u6574\u4F53\u8FC7\u7A0B\u8FDE\u7EED\u226510\u79D2\u4E3A\u51CF\u5F31\u5019\u9009\u3002\u6BCF\u6B21\u7B5B\u67E5\u4F7F\u7528\u4E00\u79CD\u65B9\u6CD5\u548C\u4E00\u4E2A\u7A97\u53E3\uFF0C\u53F3\u4FA7\u663E\u793A\u5F53\u524D\u8BBE\u7F6E\u7684\u7ED3\u679C\u3002\u4E0D\u524D\u79FB\u4E8B\u4EF6\u8D77\u70B9\uFF1B\u672A\u51CF\u603B\u6F0F\u6C14\uFF0C\u672A\u9A8C\u8BC1\u60A3\u8005\u6D41\u91CF\uFF0C\u975E\u4E34\u5E8A\u5206\u7C7B\u3002\u5207\u6362\u68C0\u6D4B\u7A97\u53E3\u53EF\u5206\u522B\u626B\u63CF\u6BD4\u8F83\uFF0C\u5404\u7A97\u53E3\u7ED3\u679C\u72EC\u7ACB\u4FDD\u5B58\u3002</small><button id="show-company-a" hidden>\u663E\u793A\u8F93\u5165\u4E0EA</button><label>\u6700\u77ED\u6301\u7EED <input id="scan-duration" type="number" min="3" max="120" step="1" value="10" style="width:65px"><select id="baseline-duration" aria-label="\u6700\u77ED\u6301\u7EED5\u81F310\u79D2" hidden><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option><option value="9">9</option><option value="10" selected>10</option></select> \u79D2</label><label id="scan-ratio-label">\u6CE2\u52A8\u964D\u81F3\u53C2\u8003\u7684 <input id="scan-ratio" type="number" min="5" max="80" step="1" value="70" style="width:65px"> %</label><small id="multi-rule-info" hidden>\u591A\u7279\u5F81\u6D4B\u8BD5\uFF1ACSV\u673A\u5668\u603B\u6D41\u91CF\u30015\u79D2\u9C81\u68D2\u5E45\u5EA6\uFF0C\u524D120\u79D2\u81F3\u5C1130\u79D2\u6709\u6548\u53C2\u8003\uFF0C\u5019\u9009\u671F\u95F4\u51BB\u7ED3\u3002\u8FD1\u6D88\u5931\u4E25\u683C\u5269\u4F59\u226410%\uFF08\u4E0B\u964D\u226590%\uFF09\uFF0C\u51CF\u5F31\u6309\u6240\u9009\u5269\u4F59\u6BD4\u4F8B\uFF08\u9ED8\u8BA450%\uFF09\uFF1B\u4E25\u683C\u8FDE\u7EED\u8FBE\u52307\u79D2\u5373\u53EF\uFF0C\u4E0D\u524D\u79FB5\u79D2\uFF0C\u65E03 L/min\u7EDD\u5BF9\u4E0B\u9650\u3002\u566A\u58F0\u4EE3\u7406\u672A\u6807\u5B9A\uFF0C\u5206\u8FA8\u7387\u4E0D\u8DB3\u65F6\u4E0D\u5224\u8FD1\u6D88\u5931\u3002\u538B\u529B/\u603B\u6F0F\u6C14\u53D8\u5316\u4FDD\u7559\u4F5C\u590D\u6838\u63D0\u793A\uFF0C\u4E0D\u6267\u884C\u8C03\u538B\u3002\u70B9\u51FB\u201C\u663E\u793A\u8F93\u5165\u4E0EA\u201D\u67E5\u770B\u5F53\u524D\u53C2\u6570\u4E0B\u7684\u53C2\u8003\u3001\u95E8\u9650\u53CA\u767E\u5206\u6BD4\uFF1B\u91CD\u590D\u79D2\u7EA7\u65F6\u95F4\u6233\u4E0D\u652F\u6301\u7CBE\u786E\u547C\u5438\u5206\u671F\u6216\u5438\u6C14\u5F62\u6001\u8BCA\u65AD\u3002</small><small id="test-rule-info" hidden>\u81EA\u9002\u5E94\u6D4B\u8BD5\uFF1ACSV\u6D41\u91CF\u30015\u79D2\u9C81\u68D2\u5E45\u5EA6\uFF1B\u524D120\u79D2\u53C2\u8003\u5728\u4E8B\u4EF6\u671F\u95F4\u51BB\u7ED3\uFF0C\u8FDF\u6EDE\u9632\u62C6\u6BB5\u3002\u8FD1\u6D88\u593110%\u3001\u51CF\u5F31\u6309\u53F3\u4FA7\u6BD4\u4F8B\uFF0C\u95E8\u9650\u81F3\u5C113 L/min\uFF1B\u8FDE\u7EED\u8FBE\u52307\u79D2\u5373\u53EF\uFF08\u53EF\u8C03\uFF09\uFF0C\u4ECE\u9996\u6B21\u8FBE\u6807\u5F00\u59CB\u8BA1\u65F6\uFF0C\u4E0D\u56DE\u6EAF5\u79D2\u3002\u53C2\u8003\u4E0D\u8DB3/\u72B6\u6001\u53D8\u5316\u540E\u91CD\u65B0\u79EF\u7D2F\u3002\u6CE2\u5F62\u53C2\u8003\u533A\u95F4\u4E0D\u8BA1\u5165\u4E8B\u4EF6\u65F6\u957F\u3002</small><small id="company-rule-info" hidden>\u70B9\u51FB\u626B\u63CF\u540E\uFF0C\u6EE1\u8DB3\u52FE\u9009\u7C7B\u578B\u53CA\u6301\u7EED\u6761\u4EF6\u7684\u533A\u95F4\u4F1A\u751F\u6210\u5DE5\u7A0B\u5019\u9009\uFF0C\u5E76\u5728\u56FE\u4E0A\u6807\u8BB0\uFF1B\u201C\u663E\u793A\u8F93\u5165\u4E0EA\u201D\u53EA\u7ED8\u56FE\u3002\u5E45\u5EA6\u89C4\u5219\u8BD5\u9A8C\uFF1A5\u79D2\u6240\u9009\u8F93\u5165\u6700\u5927\u503C\u2212\u6700\u5C0F\u503C\uFF0C\u6BCF\u79D2\u66F4\u65B0\uFF1BA&lt;10 / 10&lt;A&lt;17\uFF08\u6682\u6309L/min\uFF09\uFF0C\u6761\u4EF6\u8FDE\u7EED\u8D85\u8FC7\u6301\u7EED\u95E8\u9650\uFF08\u9ED8\u8BA47\u79D2\uFF09\uFF1B\u7B49\u4E8E10/17\u4E0D\u5F52\u7C7B\u3002\u7A97\u53E3\u53CA\u8BA1\u65F6\u53E3\u5F84\u6682\u5B9A\uFF0C\u4E0D\u6267\u884C\u8C03\u538B\u3002</small><small id="relative-rule-info">\u539F\u8BBE\u5907\u65B9\u6848\uFF1A\u8FD1\u6D88\u5931\u226410%\uFF0C\u51CF\u5F31\u9ED8\u8BA4\u226470%\uFF0C\u5747\u9700\u6301\u7EED\u8FBE\u6807\uFF1B\u53EA\u7B5B\u67E5\u673A\u5668\u6CE2\u52A8\u5F62\u6001\u3002\u4E2D\u67A2\u6682\u505C\u3001\u4E34\u5E8A\u4F4E\u901A\u6C14\u4E0EAHI\u4E0D\u53EF\u5224\u5B9A\u3002</small><details class="event-type-picker" open><summary>\u68C0\u6D4B\u54EA\u4E9B\u4E8B\u4EF6</summary><fieldset id="scan-types-fieldset"><button id="scan-types-all" type="button">\u5168\u68C0\u6D4B</button> <button id="scan-types-none" type="button">\u6E05\u7A7A\u9009\u62E9</button><div id="scan-type-options" class="event-type-options"></div><small>\u53EA\u4FDD\u5B58\u52FE\u9009\u7C7B\u578B\u7684\u5019\u9009\u3002\u5404\u65B9\u6848\u7684\u6570\u636E\u8D28\u91CF\u4E0E\u5E72\u6270\u5904\u7406\u89C1\u5BF9\u5E94\u8BF4\u660E\u3002\u5168\u68C0\u6D4B\u5305\u542B\u5F53\u524D\u65B9\u6848\u652F\u6301\u7684\u7C7B\u578B\u3002</small></fieldset></details></div></details><div id="scan-result" role="status" style="width:100%;line-height:1.7"></div><div id="device-metrics" role="status" style="width:100%;line-height:1.7"></div></div>

    <div id="status" aria-live="polite"></div><div id="plots"></div>
    <section class="wave-overview"><div class="title">\u6574\u6BB5\u6982\u89C8 \xB7 \u62D6\u52A8\u9009\u62E9\u67E5\u770B\u533A\u95F4</div><canvas id="overview"></canvas></section>
    <details id="external-tools" class="external-tools">
    <summary>\u5916\u90E8\u4E8B\u4EF6</summary>
    <div class="annotation-toolbar"><label class="file">\u5BFC\u5165\u5916\u90E8\u4E8B\u4EF6 JSON<input id="external-file" type="file" accept=".json,.txt,application/json,text/plain" hidden></label><label><input id="external-show" type="checkbox" checked> \u663E\u793A\u5916\u90E8\u4E8B\u4EF6\uFF08\u7D2B\u8272\uFF09</label><select id="external-jump" aria-label="\u8DF3\u8F6C\u5230\u5916\u90E8\u4E8B\u4EF6" hidden></select><button id="external-clear" hidden>\u6E05\u9664\u5916\u90E8\u4E8B\u4EF6</button><small id="external-status" aria-live="polite"></small></div>
    </details>

    <div class="foot">\u6CE2\u5F62\u533A\uFF1A\u6EDA\u8F6E\u6A2A\u5411\u5E73\u79FB\uFF0CCtrl + \u6EDA\u8F6E\u7F29\u653E\uFF0C\u5DE6\u952E\u6216\u53F3\u952E\u62D6\u52A8\uFF0C\u53CC\u51FB\u67E5\u770B\u6574\u6BB5\u3002\u9F20\u6807\u60AC\u505C\u663E\u793A\u663E\u793A\u70B9\u7684\u539F\u59CB\u6570\u503C\u548C\u6837\u672C\u5E8F\u53F7\u3002<br>\u7B5B\u67E5\u7ED3\u679C\u4E3A\u5DE5\u7A0B\u5019\u9009\u3002\u6CE2\u5F62\u663E\u793A\u6309\u6781\u503C\u62BD\u53D6\uFF0C\u5206\u6790\u4F7F\u7528\u539F\u59CB\u6570\u636E\u3002</div></div><aside id="event-panel" class="event-panel" aria-label="\u7B5B\u67E5\u7ED3\u679C"><div class="event-panel-head"><div><strong>\u7B5B\u67E5\u7ED3\u679C</strong><span id="event-count"></span></div></div><div class="event-panel-body"><div class="event-current-mode" aria-live="polite"><strong id="event-mode-label"></strong><small id="event-mode-config"></small><button id="result-current" type="button" hidden>\u8FD4\u56DE\u5F53\u524D\u68C0\u6D4B\u7ED3\u679C</button></div><div hidden aria-hidden="true" class="legacy-result-controls"><button id="result-auto" hidden aria-pressed="true">\u81EA\u52A8\u68C0\u6D4B</button><button id="result-company" aria-pressed="false">\u5E45\u5EA6\u89C4\u5219</button><button id="result-baseline" aria-pressed="false">\u52A8\u6001\u57FA\u7EBF\u68C0\u6D4B</button><button id="result-adaptive" hidden aria-pressed="false">\u81EA\u9002\u5E94\u6D4B\u8BD5</button><label id="adaptive-version-label" hidden>\u6D4B\u8BD5\u7248\u672C <select id="adaptive-version"><option value="adaptive-flow-test-v3-multifeature">\u65B0\u7248v3\uFF1A\u591A\u7279\u5F81 / \u4E25\u683C\u6BD4\u4F8B / 7\u79D2</option><option value="adaptive-flow-test-v2-causal">\u65E7\u7248v2\uFF1A\u542B3 L/min\u4E0B\u9650 / 7\u79D2</option><option value="adaptive-flow-test-v1">\u65E7\u7248\uFF1A10\u79D2 / \u9ED8\u8BA470%</option><option value="all">\u5168\u90E8\u5386\u53F2\u7248\u672C\uFF08\u4EC5\u4F5C\u5BF9\u7167\uFF09</option></select></label><button id="result-manual" aria-pressed="false">\u4EBA\u5DE5 / Agent</button> <label id="baseline-history-label" hidden><input id="baseline-all-configs" type="checkbox"> \u67E5\u770B\u672C\u7B97\u6CD5\u6240\u6709\u65B9\u6CD5/\u7A97\u53E3/\u6301\u7EED\u65F6\u957F\uFF08\u5386\u53F2\u5BF9\u7167\uFF09</label><div class="event-actions event-status-tools"><details class="event-backup"><summary>\u6279\u6B21\u4E0E\u5907\u4EFD</summary><div class="batch-controls"><label for="feedback-run">\u626B\u63CF\u6279\u6B21</label><select id="feedback-run" aria-label="\u626B\u63CF\u6279\u6B21"></select><div class="backup-actions"><button id="show-feedback-run" type="button">\u663E\u793A\u6279\u6B21</button><button id="feedback-refresh" type="button">\u5237\u65B0</button><button id="feedback-history" type="button">\u5386\u53F2\u6279\u6B21</button><button id="export-automatic" type="button">\u5BFC\u51FA\u81EA\u52A8 JSON</button></div><small id="feedback-batch-info"></small></div><div class="backup-actions"><button id="export-events-json">\u5BFC\u51FA JSON \u5907\u4EFD</button><button id="export-events-csv">\u5BFC\u51FA CSV</button><label class="file">\u5BFC\u5165 JSON<input id="import-events" type="file" accept=".json" hidden></label></div></details></div></div><details class="event-type-picker"><summary>\u663E\u793A\u54EA\u4E9B\u4E8B\u4EF6 \xB7 <span id="display-type-summary">\u5168\u90E8\u7C7B\u578B</span></summary><button id="display-types-all" type="button">\u663E\u793A\u5168\u90E8</button> <button id="display-types-none" type="button">\u5168\u90E8\u9690\u85CF</button><div id="display-type-options" class="event-type-options"></div><small>\u6309\u4E8B\u4EF6\u7C7B\u578B\u7B5B\u9009\u5F53\u524D\u7B97\u6CD5\u7684\u7ED3\u679C\u3002</small></details><div id="event-summary" class="event-summary"></div><small id="scan-view-note"></small><div id="event-list" class="event-list"></div></div></aside></div><button id="event-panel-backdrop" class="event-panel-backdrop" aria-label="\u5173\u95ED\u4E8B\u4EF6\u9762\u677F" hidden></button></main>
    <dialog id="scan-history-dialog" class="annotation-dialog scan-history-dialog"><h2>\u5386\u53F2\u626B\u63CF\u6279\u6B21</h2><div class="history-tools"><input id="history-query" type="search" maxlength="200" aria-label="\u641C\u7D22\u626B\u63CF\u6279\u6B21" placeholder="\u641C\u7D22\u540D\u79F0\u3001\u89C4\u5219\u7248\u672C\u3001\u68C0\u6D4B\u7C7B\u578B"><select id="history-state" aria-label="\u6279\u6B21\u5F52\u6863\u72B6\u6001"><option value="active">\u672A\u5F52\u6863</option><option value="archived">\u5DF2\u5F52\u6863</option><option value="all">\u5168\u90E8\u6279\u6B21</option></select><button id="history-search">\u641C\u7D22</button></div><p>\u5F52\u6863\u540E\u4ECD\u53EF\u6062\u590D\u6279\u6B21\uFF0C\u67E5\u770B\u6216\u5BFC\u51FA\u539F\u59CB\u68C0\u6D4B\u5FEB\u7167\u3002</p><div id="history-error" class="event-message" role="alert"></div><div id="history-list" class="history-list"></div><div class="history-tools"><button id="history-prev">\u4E0A\u4E00\u9875</button><span id="history-page"></span><button id="history-next">\u4E0B\u4E00\u9875</button><button id="history-close">\u5173\u95ED</button></div></dialog>
    <dialog id="duplicate-scan-dialog" class="annotation-dialog"><h2>\u5DF2\u6709\u76F8\u540C\u6761\u4EF6\u7684\u626B\u63CF</h2><p id="duplicate-scan-text" style="line-height:1.8;overflow-wrap:anywhere"></p><div class="dialog-actions"><button id="duplicate-cancel">\u53D6\u6D88</button><button id="duplicate-use">\u4F7F\u7528\u5DF2\u6709\u6279\u6B21</button><button id="duplicate-rescan">\u4ECD\u7136\u91CD\u65B0\u626B\u63CF</button></div></dialog>
    </div><script src="/annotation-model.js"><\/script><script src="/viewer.js"><\/script></body></html>
    `;

    // somnus-waveform:D:\VVFLY\SomnusNext\page_design\dashboard.css
    var dashboard_default = ':root{font-family:Inter,"Microsoft YaHei","PingFang SC",sans-serif;color:#233346;background:#f5f7fa;font-synthesis:none}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button{font:inherit;cursor:pointer}button:disabled{cursor:wait;opacity:.65}[hidden]{display:none!important}.sidebar{position:fixed;inset:0 auto 0 0;width:236px;background:#fff;border-right:1px solid #e5eaf0;padding:32px 20px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:11px;font-size:16px;font-weight:700;white-space:nowrap}.brand-icon{display:grid;place-items:center;color:white;background:#137d87;width:37px;height:39px;border-radius:11px;font-size:23px}.brand small{display:block;font-size:9px;letter-spacing:1.5px;color:#8c9aaa;margin-top:5px}.nav-label{font-size:11px;color:#94a1ae;margin:45px 16px 15px;letter-spacing:1px}.nav-item{display:flex;align-items:center;gap:13px;padding:13px 16px;border-radius:8px;font-size:14px;color:#647488;margin-bottom:7px}.nav-item>span:first-child{font-size:22px;line-height:1}.nav-item:hover{background:#f2f6f8}.nav-item.active{background:#e9f5f5;color:#137d87;font-weight:700}.nav-arrow{margin-left:auto}.sidebar-bottom{margin-top:auto;font-size:12px;color:#5c7081;padding:18px 12px 0;border-top:1px solid #eef1f4}.sidebar-bottom p{font-size:11px;color:#98a2ae;margin-bottom:0}.local-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#36a18d;margin-right:6px}main{margin-left:236px;padding:0 42px 28px;max-width:1900px}header{height:77px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5eaf0}.breadcrumb{font-size:12px;color:#7a8b9a}.breadcrumb span{margin:0 12px;color:#bdc6cf}.badge{font-size:11px;color:#647b88;background:#fff;padding:7px 12px;border:1px solid #e6ebef;border-radius:20px}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:34px 0 12px}.eyebrow{font-size:10px;letter-spacing:2px;color:#78909d;font-weight:700}h1{font-size:29px;letter-spacing:-.5px;margin:9px 0 12px}p{line-height:1.7}.page-heading p{font-size:13px;color:#81909f;margin:0}button{background:#fff;border:1px solid #dce3ea;border-radius:7px;padding:10px 15px;font-size:12px;color:#526779;white-space:nowrap}button span{margin-left:10px}button:hover{border-color:#137d87}a:focus-visible,button:focus-visible{outline:3px solid #8ecbd0;outline-offset:3px}.load-status{font-size:11px;color:#8c9baa;min-height:21px;margin:0 0 18px}.error{padding:12px 16px;background:#fff2ed;border:1px solid #f1d7cb;color:#9c482b;border-radius:8px;font-size:13px;margin-bottom:18px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.metric{background:#fff;border:1px solid #e6ebf0;border-radius:11px;padding:21px 22px}.metric-label{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#6b7f90;gap:8px}.metric-label span{color:#7ca6af;font-size:20px}.metric strong{display:block;font-size:30px;line-height:1.3;margin:16px 0 12px;letter-spacing:-1px;font-weight:650;font-variant-numeric:tabular-nums}.metric p{font-size:11px;color:#8d9aa7;margin:0}.content-grid{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(270px,1fr);gap:22px;margin:24px 0}.panel{background:#fff;border:1px solid #e5eaf0;border-radius:11px;overflow:hidden}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:23px 24px 20px}h2{font-size:15px;margin:0}.panel-heading p{font-size:11px;color:#92a0ad;margin:7px 0 0;overflow-wrap:anywhere}.text-link{font-size:11px;color:#167d87;white-space:nowrap}.text-link span{margin-left:6px}.record-list{min-height:217px;max-height:370px;overflow:auto}.record{display:grid;grid-template-columns:35px minmax(0,1fr) auto;align-items:center;gap:12px;padding:15px 24px;border-top:1px solid #f0f3f6}.record-icon{display:grid;place-items:center;background:#f0f5f8;border-radius:7px;width:33px;height:38px;color:#7b9cae;font-size:18px}.record-name{font-size:12px;font-weight:600;overflow-wrap:anywhere;line-height:1.5}.record-meta{font-size:10px;color:#94a2ae;margin-top:5px}.record-state{font-size:10px;border-radius:5px;background:#edf7f6;color:#23867e;padding:5px 7px;white-space:nowrap}.record-state.idle{background:#f4f6f8;color:#8e9ba7}.panel-footer{padding:13px 24px;background:#fcfdfe;border-top:1px solid #edf1f4;font-size:10px;color:#97a4af;line-height:1.7}.analysis-panel{padding:25px 27px;background:linear-gradient(135deg,#f6fbfb,#fff);display:flex;flex-direction:column;align-items:flex-start}.module-symbol{display:grid;place-items:center;background:#e0f1f0;color:#147c83;border-radius:11px;width:45px;height:45px;font-size:33px;margin-bottom:21px}.module-label{font-size:9px;letter-spacing:1.3px;color:#7c9b9e;margin-bottom:10px}.analysis-panel h2{font-size:21px}.analysis-panel>p{font-size:12px;color:#7e929b;margin:11px 0 17px}.module-steps{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:24px}.module-steps span{font-size:10px;color:#6e8b90;background:#edf5f5;padding:5px 7px;border-radius:4px}.primary-link{background:#147d86;border-radius:7px;color:#fff;font-size:12px;padding:12px 16px;display:flex;justify-content:space-between;gap:18px;width:100%;margin-top:auto}.primary-link:hover{background:#106a72}.analysis-panel>small{font-size:9px;color:#94a7ad;margin:12px auto 0}.channels-panel{margin-bottom:20px}.pill{background:#f3f7fa;color:#7b8e9e;border-radius:20px;padding:6px 10px;font-size:10px;white-space:nowrap}.channel-list{display:flex;flex-wrap:wrap;gap:10px;padding:0 24px 25px}.channel{border:1px solid #e7edf1;border-radius:6px;padding:9px 12px;font-size:11px;color:#5f7888;background:#fcfdfe;overflow-wrap:anywhere;max-width:100%}.channel small{color:#95a4ae;margin-left:10px}.muted,.empty{color:#94a2af;font-size:12px;line-height:1.8}.empty{padding:43px 25px;text-align:center}.empty a{color:#147d86}footer{font-size:10px;line-height:1.9;color:#9aa6b1;padding:0 2px}@media(min-width:1600px){main{padding-left:55px;padding-right:55px}.metric{padding:25px}.record-list{min-height:240px}}@media(max-width:1150px){.sidebar{width:200px;padding-left:15px;padding-right:15px}main{margin-left:200px;padding:0 24px 24px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.content-grid{grid-template-columns:minmax(0,1.5fr) minmax(250px,1fr)}.metric strong{font-size:27px}}@media(max-width:800px){.sidebar{position:static;width:auto;padding:15px 20px;border-right:0;border-bottom:1px solid #e5eaf0;display:block}.brand{font-size:14px}.brand-icon{height:32px;width:32px;font-size:19px}.brand small{font-size:8px}.nav-label,.sidebar-bottom{display:none}nav{display:flex;gap:8px;margin-top:18px}.nav-item{padding:10px 14px;margin:0;font-size:12px}.nav-item>span:first-child{font-size:18px}.nav-arrow{display:none}main{margin-left:0;padding:0 20px 25px}header{height:54px}.page-heading{margin-top:26px}.page-heading p{font-size:11px}.content-grid{grid-template-columns:1fr}.record-list{max-height:340px;min-height:150px}.analysis-panel{padding:24px}.module-symbol{margin-bottom:14px}.analysis-panel>small{margin-left:0}.primary-link{max-width:300px}.metrics{gap:12px}.metric{padding:16px}.metric strong{font-size:25px;margin-top:12px}.metric-label{font-size:11px}.metric p{font-size:10px}.panel-heading{padding:20px}.record{padding:14px 20px}.channel-list{padding:0 20px 22px}h1{font-size:25px}}@media(max-width:400px){main{padding-left:14px;padding-right:14px}.metric{padding:13px}.metric-label span{display:none}.metric strong{font-size:22px}.record{grid-template-columns:28px minmax(0,1fr);gap:10px}.record-state{grid-column:2;justify-self:start}.record-icon{width:28px}.page-heading{align-items:flex-start}button{padding:9px}.badge{font-size:10px}}\n/* User analytics additions are scoped to avoid changing the detection workspace. */\n.analytics-page{background:#f5f7fa;color:#233346;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei","Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:22px}\n.analytics-page :is(button,input,select){font-family:inherit;font-size:13px;line-height:20px}\n.analytics-page .analytics-filters{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:24px 0 16px}\n.analytics-page .range-presets{display:flex;gap:4px;padding:4px;background:#eaf0f3;border-radius:9px}\n.analytics-page .range-presets button{border-color:transparent;background:transparent;padding:8px 13px}\n.analytics-page .range-presets button[aria-pressed=true]{background:#fff;color:#137d87;box-shadow:0 1px 4px #23334612;font-weight:600}\n.analytics-page #date-form{display:flex;gap:9px;align-items:center;flex-wrap:wrap}\n.analytics-page #date-form label{font-size:11px;color:#617688;display:flex;align-items:center;gap:7px}\n.analytics-page input[type=date]{font:inherit;border:1px solid #dce3ea;border-radius:7px;padding:8px;background:#fff;color:#526779;min-width:0}\n.analytics-page input:focus-visible{outline:3px solid #8ecbd0;outline-offset:2px}\n.analytics-page #source-toggle{margin-left:auto;color:#137d87;border-color:#a9cfd0}\n.analytics-page .source-notice{padding:13px 17px;border:1px solid #dce7eb;background:#eef5f8;color:#536e7d;border-radius:9px;font-size:12px;line-height:1.8;margin-bottom:12px}\n.analytics-page .demo-notice{background:#fff7e5;border-color:#f0deb4;color:#805e1e}\n.analytics-page .demo-badge{background:#fff7e5;color:#805e1e;border-color:#f0deb4}\n.analytics-page .metric-definition{font-size:11px;color:#708394;line-height:1.9;margin:13px 2px 22px}\n.analytics-page .trend-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}\n.analytics-page .trend-chart{padding:0 16px 16px;min-width:0;min-height:250px}\n.analytics-page .trend-chart svg{display:block;width:100%;height:auto;overflow:visible}\n.analytics-page .chart-grid{stroke:#eaf0f3;stroke-width:1}\n.analytics-page .chart-label{fill:#728697;font-size:11px;font-family:inherit}\n.analytics-page .chart-line{fill:none;stroke:#16868c;stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}\n.analytics-page .chart-point{fill:#16868c;stroke:white;stroke-width:1}\n.analytics-page .chart-data{font-size:11px;color:#5f7888;margin:0 8px}\n.analytics-page .chart-data summary{cursor:pointer;color:#137d87;padding:6px 0}\n.analytics-page .chart-data ul{max-height:160px;overflow:auto;margin:8px 0;padding-left:22px;line-height:1.9}\n.analytics-page .analytics-bottom{grid-template-columns:minmax(0,2.3fr) minmax(260px,1fr)}\n.analytics-page .users-table-wrap{overflow-x:auto;max-height:480px}\n.analytics-page .users-table{width:100%;border-collapse:collapse;font-size:11px;white-space:nowrap}\n.analytics-page .users-table th{background:#f8fafb;font-weight:500;color:#728595;position:sticky;top:0}\n.analytics-page .users-table :is(th,td){padding:14px 18px;text-align:left;border-bottom:1px solid #eef2f5;vertical-align:middle}\n.analytics-page .users-table td:first-child{max-width:220px;min-width:120px;white-space:normal;overflow-wrap:anywhere}\n.analytics-page .user-name{font-size:12px;display:block;font-weight:600}\n.analytics-page .user-id{display:block;font-size:10px;color:#8798a6;margin-top:5px}\n.analytics-page .users-table .pill{display:inline-block;font-size:10px}\n.analytics-page .empty{color:#728595}.analytics-page .load-status{color:#728595}\n@media(max-width:1200px){.analytics-page .analytics-bottom{grid-template-columns:minmax(0,1fr)}.analytics-page .analysis-panel{display:block}.analytics-page .analysis-panel .primary-link{max-width:300px}.analytics-page .analysis-panel>small{display:block;margin:12px 0 0}}\n@media(max-width:800px){.analytics-page .trend-grid{grid-template-columns:minmax(0,1fr);gap:16px}.analytics-page .analytics-filters{align-items:stretch;gap:12px}.analytics-page #date-form{width:100%}.analytics-page #date-form label{flex:1;flex-direction:column;align-items:stretch}.analytics-page #date-form button{align-self:flex-end}.analytics-page #source-toggle{margin-left:0}.analytics-page .trend-chart{min-height:190px;padding:0 8px 14px}.analytics-page .page-heading{align-items:flex-start}.analytics-page header .badge{max-width:48%;white-space:normal;text-align:right}.analytics-page .users-table :is(th,td){padding:12px}.analytics-page .panel-heading{flex-wrap:wrap}}\n@media(max-width:400px){.analytics-page #date-form label{flex-basis:100%}.analytics-page #date-form button{width:100%}.analytics-page .metric-label{font-size:10px}.analytics-page .range-presets{width:100%;justify-content:space-between}}\r\n';

    // somnus-waveform:D:\VVFLY\SomnusNext\page_design\events.css
    var events_default = `/* Shared React-workbench visual language; waveform and event behavior stays in the original viewer. */
    .events-page{color:var(--text);font-size:13px;line-height:1.5}.events-page a{color:inherit;text-decoration:none}.events-page [hidden]{display:none!important}
    .events-global-header{height:72px;position:fixed;inset:0 0 auto;z-index:85;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 28px;background:#fff;border-bottom:1px solid var(--border)}.events-main-brand{display:flex;align-items:center;gap:11px;font-size:18px;font-weight:600;color:var(--text);white-space:nowrap}.events-brand-mark{display:grid;place-items:center;width:38px;height:38px;background:var(--primary);color:#fff;border-radius:10px;box-shadow:0 3px 9px #20212412}.events-main-brand small{display:block;font-size:9px;letter-spacing:1.6px;color:var(--muted);margin-top:5px;font-weight:400}.events-header-status{font-size:12px;color:var(--muted);white-space:nowrap}.events-header-status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#00a887;margin-right:8px}
    .events-page .sidebar{position:fixed;inset:72px auto 0 0;width:184px;z-index:80;padding:24px 8px;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column}.events-page .sidebar>.brand{display:none}.events-page .nav-label{padding:0 16px;margin:0 0 14px;font-size:11px;color:var(--muted);letter-spacing:1px}.events-page .sidebar nav{display:block;margin:0}.events-page .nav-item{min-height:44px;padding:11px 16px;margin:0 0 8px;border-radius:8px;font-size:13px;font-weight:400;color:var(--muted);gap:11px}.events-page .nav-item>span:first-child{font-size:18px}.events-page .nav-item:hover{background:var(--hover);color:var(--primary)}.events-page .nav-item.active{background:var(--selected);color:var(--primary);font-weight:500}.events-page .sidebar-bottom{padding:24px 12px;margin-top:auto;border-top:0;font-size:11px;color:var(--muted)}.events-page .sidebar-bottom p{color:var(--muted);font-size:10px}.event-shell{margin-left:184px;padding-top:72px;min-width:0}
    .events-page .event-shell>header{height:auto;min-height:0;margin:0;padding:24px 28px 18px;background:transparent;color:var(--text);border:0;gap:20px;display:flex;align-items:center;justify-content:space-between}.events-page header .breadcrumb{font-size:11px;color:var(--muted);margin:0 0 10px}.events-page header h1{font-size:25px;font-weight:600;letter-spacing:0;margin:0 0 8px}.events-page header small{color:var(--muted);font-size:12px}.events-page .events-return-link{color:var(--primary);font-size:12px}.events-page .events-return-link:hover{text-decoration:underline}.events-page main{margin:0;max-width:none;padding:0 28px 28px}.events-page .workspace{grid-template-columns:210px minmax(0,1fr) 320px;gap:20px}.events-page.event-panel-collapsed .workspace{grid-template-columns:210px minmax(0,1fr)}
    .events-page section,.events-page .channel-sidebar,.events-page .event-panel{background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 2px 8px #253d5a03}.events-page .title{font-size:13px;font-weight:600;padding:13px 16px;border-bottom:1px solid var(--border);background:#fff;gap:10px;flex-wrap:wrap}.events-page .value{color:var(--muted)}.events-page .toolbar,.events-page .annotation-toolbar{background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px;gap:9px;margin:0 0 16px;line-height:1.8}.events-page .annotation-toolbar>strong{color:var(--text);font-size:13px}.events-page .annotation-toolbar>small{flex-basis:100%;line-height:1.8;color:var(--muted)}.events-page .toolbar label,.events-page .annotation-toolbar label{color:var(--muted);font-size:12px}.events-page button,.events-page .file{font:400 12px/1.6 Inter,"Microsoft YaHei","PingFang SC",sans-serif;border:1px solid var(--border);background:#fff;color:var(--text);padding:6px 12px;border-radius:6px;transition:border-color .15s,background .15s;box-shadow:0 2px 0 #00000002}.events-page button:hover:not(:disabled){color:var(--primary);border-color:var(--selected-border);background:var(--hover)}.events-page .file,.events-page #scan-all,.events-page #scan-window,.events-page #go,.events-page #event-form button[type=submit],.events-page #package-save,.events-page #export-package{background:var(--primary)!important;color:white!important;border-color:var(--primary);padding:7px 14px}.events-page .file:hover,.events-page #scan-all:hover,.events-page #scan-window:hover,.events-page #go:hover{background:var(--primary-hover)!important}.events-page button:disabled{cursor:not-allowed;opacity:.5}.events-page button[aria-pressed=true],.events-page .library-file[aria-pressed=true]{color:var(--primary);background:var(--selected);border-color:var(--selected-border)}.events-page button[aria-pressed=true]:hover{background:var(--selected)}.events-page input:not([type=checkbox]):not([type=file]),.events-page select,.events-page textarea{font:400 12px/1.6 Inter,"Microsoft YaHei","PingFang SC",sans-serif;color:var(--muted);background:#fff;border:1px solid var(--border);border-radius:6px;padding:6px 9px;max-width:100%;min-width:0}.events-page input:disabled,.events-page select:disabled{background:var(--subtle);color:var(--muted)}.events-page input[type=checkbox]{accent-color:var(--primary)}.events-page :is(input,select,textarea,button,a):focus-visible{outline:3px solid var(--primary);outline-offset:2px}
    .events-page .note{background:var(--subtle);border:1px solid var(--border);border-radius:8px;color:var(--muted);padding:11px 14px;font-size:12px;line-height:1.8;margin:0 0 16px}.events-page .note strong{color:var(--muted);font-weight:500}.events-page .info{font-size:11px;color:var(--muted);padding:0;margin:0 0 16px;gap:16px}.events-page #error:empty{display:none}.events-page #error:not(:empty){font-size:12px;background:#fff4f0;border:1px solid #f3ded3;border-radius:7px;padding:10px 14px;margin-bottom:16px}.events-page #status{font-size:11px;color:var(--muted);min-height:25px}.events-page .foot,.events-page .event-summary{font-size:11px;color:var(--muted);line-height:1.9}.events-page .event-type-picker{border-color:var(--border);border-radius:7px;background:var(--subtle)}.events-page .event-type-picker summary{color:var(--muted);font-size:12px}.events-page .event-type-picker small{color:var(--muted)}.events-page .event-type-options input{accent-color:var(--primary)}.events-page .event-type-options label{font-size:12px}
    .events-page .channel-sidebar{position:sticky;top:90px;max-height:calc(100dvh - 108px);overflow:hidden}.events-page .sidebar-head{padding:15px 13px 10px;display:flex;align-items:center;justify-content:space-between;gap:5px}.events-page .sidebar-head strong{font-size:13px;font-weight:600;color:var(--text)}.events-page .sidebar-head small{font-size:10px;color:var(--muted)}.events-page .sidebar-tools{padding:0 11px 11px;gap:7px}.events-page .sidebar-tools button{font-size:11px;padding:4px 8px}.events-page .sidebar-tools label{font-size:10px;color:var(--muted)}.events-page #channels{border-top-color:var(--border);min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:6px}.events-page #channels label{font-size:12px;padding:8px;border-radius:6px;color:var(--muted)}.events-page #channels label:hover{background:var(--hover)}.events-page #channels label:has(input:checked){background:var(--selected);color:var(--primary)}.events-page #channels input{accent-color:var(--primary)}.events-page .file-library{border-bottom-color:var(--border);padding-left:11px;padding-right:11px}.events-page #file-list{overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.events-page .file-library>small,.events-page .sidebar-foot{color:var(--muted);font-size:10px;line-height:1.8}.events-page .sidebar-foot{border-top-color:var(--border);padding:11px 13px}.events-page .library-close{font-size:17px;padding:2px;box-shadow:none}.events-page .library-close:hover{color:#d75d69;border-color:#efc5cb;background:#fff7f7}.events-page .channel-chip{background:var(--subtle);border-color:var(--border);color:var(--muted)}.events-page .channel-chip select{font-size:10px}.events-page .axis-note{color:var(--muted)}.events-page .group-value{font-size:11px}.events-page .drop-target{outline-color:var(--primary);background:var(--selected)}
    .events-page .event-panel{top:90px;max-height:calc(100dvh - 108px)}.events-page .event-panel-head{background:var(--subtle);border-bottom-color:var(--border);padding:15px}.events-page .event-panel-head strong{font-size:13px;font-weight:600;color:var(--text)}.events-page .event-panel-head span{font-size:10px;color:var(--muted)}.events-page .event-panel-body{padding:13px}.events-page .event-row{border-color:var(--border);padding:13px 0}.events-page .event-row small{color:var(--muted)}.events-page .event-current-mode{background:var(--subtle);border-color:var(--border);color:var(--muted)}.events-page .event-current-mode strong{font-size:12px}.events-page .event-current-mode small{color:var(--muted)}.events-page .annotation-dialog{background:#fff;border:1px solid var(--border);border-radius:10px;box-shadow:0 20px 80px #20212426;color:var(--text);margin:auto}.events-page .annotation-dialog::backdrop{background:#20212433}.events-page .annotation-dialog h2{font-size:17px;color:var(--text);font-weight:600}.events-page .event-backup{border-color:var(--border);background:var(--subtle)}.events-page #feedback-batch-info{color:var(--muted);font-size:11px}
    @media(max-width:1500px){.events-page .workspace{grid-template-columns:195px minmax(0,1fr);gap:16px}.events-page.event-panel-collapsed .workspace{grid-template-columns:195px minmax(0,1fr)}.events-page .event-panel{grid-column:2;height:480px;position:relative;top:0}.events-page .event-shell>header{padding:22px}.events-page main{padding:0 22px 22px}}
    @media(max-width:1100px){.events-page .event-panel{position:fixed;inset:84px 12px 12px auto;width:min(380px,calc(100vw - 24px));height:calc(100dvh - 96px);max-height:none;z-index:100;box-shadow:0 12px 40px #20212433;grid-column:auto}.events-page .event-panel-backdrop{display:block;z-index:90;inset:72px 0 0}.events-page .workspace,.events-page.event-panel-collapsed .workspace{grid-template-columns:190px minmax(0,1fr)}}
    @media(max-width:900px){.events-global-header{padding:0 20px}.events-main-brand{font-size:16px}.events-page .sidebar{width:64px;padding:24px 7px}.events-page .sidebar .nav-label,.events-page .sidebar-bottom{display:none}.events-page .nav-item{font-size:0;justify-content:center;padding:12px 0;min-height:44px}.events-page .nav-item>span:first-child{font-size:20px}.event-shell{margin-left:64px}.events-page .event-shell>header{padding:22px 18px}.events-page main{padding:0 18px 22px}.events-page .event-shell>header h1{font-size:23px}.events-page .workspace,.events-page.event-panel-collapsed .workspace{grid-template-columns:180px minmax(0,1fr);gap:14px}}
    @media(max-width:680px){.events-global-header{height:64px;padding:0 16px}.events-main-brand{font-size:14px}.events-brand-mark{height:32px;width:32px}.events-main-brand small{font-size:8px}.events-header-status{display:none}.events-page .sidebar{display:none}.event-shell{margin-left:0;padding-top:64px}.events-page .event-shell>header{padding:20px 16px;align-items:flex-start;flex-wrap:wrap;gap:14px}.events-page .event-shell>header h1{font-size:22px}.events-page main{padding:0 12px 20px}.events-page .workspace,.events-page.event-panel-collapsed .workspace{grid-template-columns:minmax(0,1fr)}.events-page .channel-sidebar{position:relative;top:0;height:380px!important;max-height:50dvh;min-height:280px}.events-page .file-library{max-height:180px}.events-page #file-list{max-height:90px}.events-page #channels{min-height:50px;max-height:none}.events-page .sidebar-head{padding-top:12px}.events-page .sidebar-tools{padding-bottom:8px}.events-page .event-panel{inset:76px 10px 10px auto;width:min(380px,calc(100vw - 20px));height:calc(100dvh - 86px)}.events-page .event-panel-backdrop{inset:64px 0 0}.events-page .event-time-inputs{grid-template-columns:1fr}.events-page .toolbar,.events-page .annotation-toolbar{padding:12px}.events-page #feedback-run{max-width:calc(100vw - 85px)}.events-page .event-shell>header>.file{white-space:normal;text-align:center}}

    /* Embedded analysis uses the React shell, never a second global header or rail. */
    .events-page.analysis-embedded .events-global-header,.events-page.analysis-embedded>.sidebar,.events-page.analysis-embedded .events-back-link-wrap{display:none!important}.events-page.analysis-embedded .event-shell{margin-left:0;padding-top:0}.events-page.analysis-embedded .event-shell>header{padding:24px 28px 18px}.events-page.analysis-embedded .channel-sidebar{top:16px;max-height:calc(100dvh - 32px)}.events-page.analysis-embedded .event-panel{top:16px;max-height:calc(100dvh - 32px)}.events-page.analysis-embedded .event-panel-backdrop{inset:0}
    /* Keep the event list beside the waveform on mid-size screens instead of stacking it below the fold. */
    @media(min-width:1101px) and (max-width:1500px){.events-page .workspace{grid-template-columns:195px minmax(0,1fr) 320px;gap:14px}.events-page.event-panel-collapsed .workspace{grid-template-columns:195px minmax(0,1fr)}.events-page .event-panel{grid-column:3;position:sticky;top:0;height:calc(100dvh - 180px);max-height:calc(100dvh - 32px)}}
    @media(max-width:1500px){.events-page.analysis-embedded .event-shell>header{padding:22px}.events-page.analysis-embedded .event-panel{top:0}}@media(max-width:1100px){.events-page.analysis-embedded .event-panel{inset:12px 12px 12px auto;height:calc(100dvh - 24px);max-height:none}}@media(max-width:680px){.events-page.analysis-embedded .event-shell>header{padding:20px 16px}.events-page.analysis-embedded .channel-sidebar{top:0;max-height:50dvh}.events-page.analysis-embedded .event-panel{inset:10px 10px 10px auto;height:calc(100dvh - 20px)}}

    /* Embedded workspace adjustments. */
    .events-page.analysis-embedded {
      background: var(--surface);
    }

    .analysis-embedded.events-page .event-shell > header { padding: 14px 18px 10px; gap: 8px 16px; }
    .analysis-embedded.events-page header .breadcrumb { display: none; }
    .analysis-embedded.events-page header h1 { margin: 0; font-size: 22px; }
    .analysis-embedded.events-page header small,
    .analysis-embedded.events-page .info { color: var(--muted); }
    .analysis-embedded.events-page main { padding: 0 18px 18px; }
    .analysis-embedded.events-page .info { gap: 6px 12px; margin: 0 0 9px; overflow-wrap: anywhere; }
    .analysis-embedded.events-page .note,
    .analysis-embedded.events-page .toolbar,
    .analysis-embedded.events-page .annotation-toolbar {
      background: var(--subtle);
      border-color: var(--border);
      color: var(--muted);
      padding: 6px 9px;
      gap: 5px 7px;
      margin: 0 0 8px;
      line-height: 1.5;
    }
    .analysis-embedded.events-page .note strong,
    .analysis-embedded.events-page .annotation-toolbar > strong { color: var(--text); }
    .analysis-embedded.events-page .annotation-toolbar > small,
    .analysis-embedded.events-page .toolbar label,
    .analysis-embedded.events-page .annotation-toolbar label,
    .analysis-embedded.events-page #status,
    .analysis-embedded.events-page .foot,
    .analysis-embedded.events-page .event-summary,
    .analysis-embedded.events-page .event-row small,
    .analysis-embedded.events-page .sidebar-head small,
    .analysis-embedded.events-page .sidebar-tools label,
    .analysis-embedded.events-page .file-library > small,
    .analysis-embedded.events-page .sidebar-foot { color: var(--muted); }
    .analysis-embedded.events-page #status { min-height: 0; }
    .analysis-embedded.events-page #status:empty,
    .analysis-embedded.events-page #external-status:empty,
    .analysis-embedded.events-page #scan-result:empty,
    .analysis-embedded.events-page #device-metrics:empty { display: none; }

    .analysis-embedded.events-page :is(section, .channel-sidebar, .event-panel, .title, .annotation-dialog) {
      background: var(--surface);
      border-color: var(--border);
      box-shadow: none;
      color: var(--text);
    }
    .analysis-embedded.events-page :is(.sidebar-head, .event-panel-head) { padding: 8px 10px; }
    .analysis-embedded.events-page :is(.sidebar-head, .event-panel-head) strong { color: var(--text); }
    .analysis-embedded.events-page :is(.event-panel-head, .event-current-mode, .event-backup, .event-type-picker, .channel-chip) {
      background: var(--subtle);
      color: var(--text);
      border-color: var(--border);
    }
    .analysis-embedded.events-page .title { padding: 7px 10px; }
    .analysis-embedded.events-page #channels label { padding: 5px; color: var(--muted); }
    .analysis-embedded.events-page #channels label:has(input:checked) { background: var(--selected); color: var(--primary); }
    .analysis-embedded.events-page :is(.sidebar-foot, .file-library, #channels, .event-row, .event-list, .event-status-tools) { border-color: var(--border); }
    .analysis-embedded.events-page :is(button, .file, select, textarea),
    .analysis-embedded.events-page input:not([type=checkbox]):not([type=file]) {
      background: var(--surface);
      color: var(--text);
      border-color: var(--border);
      box-shadow: none;
      padding: 4px 8px;
    }
    .analysis-embedded.events-page button:not(:disabled):hover { color: var(--primary); background: var(--hover); border-color: var(--selected-border); }
    .analysis-embedded.events-page :is(button[aria-pressed=true], .library-file[aria-pressed=true]) { background: var(--selected); color: var(--primary); border-color: var(--selected-border); }
    .analysis-embedded.events-page :is(.file, #scan-all, #scan-window, #go, #event-form button[type=submit], #package-save, #export-package):hover { background: var(--primary-hover) !important; }
    .analysis-embedded.events-page :is(input, select, textarea, button, a):focus-visible { outline-color: var(--primary); }
    .analysis-embedded.events-page .event-panel-backdrop { background: #20212444; border: 0; }
    .analysis-embedded.events-page .annotation-dialog::backdrop { background: #20212444; }

    .analysis-embedded.events-page .workspace { grid-template-columns: 172px minmax(0, 1fr) 264px; gap: 12px; }
    .analysis-embedded.events-page.event-panel-collapsed .workspace { grid-template-columns: 172px minmax(0, 1fr); }
    .analysis-embedded.events-page .event-panel { top: 12px; }
    .analysis-embedded.events-page .channel-sidebar { top: 12px; }

    @media (max-width: 1100px) {
      .analysis-embedded.events-page .workspace { grid-template-columns: 172px minmax(0, 1fr); }
      .analysis-embedded.events-page .event-panel { box-shadow: 0 12px 35px #20212430; }
    }
    @media (max-width: 760px) {
      .analysis-embedded.events-page .event-shell > header { padding: 11px 10px 8px; }
      .analysis-embedded.events-page main { padding-inline: 10px; }
      .analysis-embedded.events-page .workspace,
      .analysis-embedded.events-page.event-panel-collapsed .workspace { grid-template-columns: minmax(0, 1fr); }
      .analysis-embedded.events-page .chart-area { grid-row: 1; }
      .analysis-embedded.events-page .channel-sidebar { position: relative; top: 0; height: auto !important; min-height: 0; max-height: none; }
      .analysis-embedded.events-page #channels { flex: auto; max-height: 190px; }
    }

    .analysis-embedded.events-page .record-scope { padding-block: 5px; font-size: 11px; }
    .analysis-embedded.events-page .view-tools { display: grid; gap: 5px; margin-bottom: 8px; }
    .analysis-embedded.events-page .view-tools .toolbar { margin-bottom: 0; }
    .analysis-embedded.events-page :is(.analysis-notes, .scan-options, .external-tools) {
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
    }
    .analysis-embedded.events-page :is(.analysis-notes, .scan-options, .external-tools) > summary { cursor: pointer; padding: 3px 0; }
    .analysis-embedded.events-page .scan-options { flex-basis: 100%; }
    .analysis-embedded.events-page .analysis-notes .note { margin: 4px 0; }
    .analysis-embedded.events-page .external-tools { margin: 8px 0; }
    .analysis-embedded.events-page .external-tools .annotation-toolbar { margin-top: 5px; }
    .analysis-embedded.events-page :is(.display-toolbar, .scan-toolbar) > select { max-width: min(100%, 290px); }
    .analysis-embedded.events-page .workspace > .channel-sidebar { grid-column: 1; }
    .analysis-embedded.events-page .workspace > .chart-area { grid-column: 2; }
    .analysis-embedded.events-page.channel-panel-collapsed .channel-sidebar { display: none; }
    .analysis-embedded.events-page.channel-panel-collapsed .workspace { grid-template-columns: minmax(0, 1fr) 264px; }
    .analysis-embedded.events-page.channel-panel-collapsed.event-panel-collapsed .workspace { grid-template-columns: minmax(0, 1fr); }
    .analysis-embedded.events-page.channel-panel-collapsed .workspace > .chart-area { grid-column: 1; }
    @media (min-width: 1101px) {
      .analysis-embedded.events-page.channel-panel-collapsed .workspace > .event-panel { grid-column: 2; }
    }
    @media (max-width: 1100px) {
      .analysis-embedded.events-page.channel-panel-collapsed .workspace { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 760px) {
      .analysis-embedded.events-page .workspace > .chart-area { grid-column: 1; grid-row: 2; }
      .analysis-embedded.events-page.channel-panel-collapsed .workspace > .chart-area { grid-row: 1; }
      .analysis-embedded.events-page .workspace > .channel-sidebar { grid-row: 1; }
    }

    .analysis-embedded.events-page .record-context {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 4px 12px;
      margin-bottom: 9px;
      padding: 6px 9px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--subtle);
    }
    .analysis-embedded.events-page .record-context .info,
    .analysis-embedded.events-page .record-scope { margin: 0; padding: 0; color: var(--muted); }
    .analysis-embedded.events-page .overlay-help {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px 7px;
      margin: 0;
    }
    .analysis-embedded.events-page .analysis-notes { margin-bottom: 7px; }
    .analysis-embedded.events-page .scan-options-body {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 9px;
      padding-top: 5px;
    }
    .analysis-embedded.events-page .scan-options-body > small { flex-basis: 100%; }
    .analysis-embedded.events-page .event-panel-backdrop:hover:not(:disabled) { background: #20212444; }

    /* The file and channel panel is the embedded analysis navigation column. */
    @media (min-width: 761px) {
      .analysis-embedded.events-page { --analysis-sidebar-width: 186px; }
      .analysis-embedded.events-page:not(.channel-panel-collapsed) .event-shell {
        padding-inline-start: var(--analysis-sidebar-width);
      }
      .analysis-embedded.events-page .workspace {
        grid-template-columns: minmax(0, 1fr) 264px;
      }
      .analysis-embedded.events-page.event-panel-collapsed .workspace {
        grid-template-columns: minmax(0, 1fr);
      }
      .analysis-embedded.events-page .workspace > .chart-area { grid-column: 1; }
      .analysis-embedded.events-page .workspace > .channel-sidebar {
        position: fixed;
        inset: 0 auto 0 0;
        width: var(--analysis-sidebar-width);
        height: 100dvh;
        max-height: none;
        border-width: 0 1px 0 0;
        border-radius: 0;
        background: var(--subtle);
      }
    }
    @media (min-width: 1101px) {
      .analysis-embedded.events-page .workspace > .event-panel { grid-column: 2; }
    }
    @media (min-width: 761px) and (max-width: 1100px) {
      .analysis-embedded.events-page .workspace { grid-template-columns: minmax(0, 1fr); }
    }

    /* Match the Somnus desktop shell tokens inside the viewer document. */
    .events-page, .events-page.analysis-embedded {
      --primary: #176d61;
      --primary-hover: #11564c;
      --text: #202a28;
      --muted: #526762;
      --border: #dce8e3;
      --surface: #fff;
      --subtle: #f5f8f7;
      --hover: #eef6f2;
      --selected: #e8f5f0;
      --selected-border: var(--border);
    }
    .events-page .event-shell > header { padding-block: 14px 10px; }
    .events-page .record-context { margin-bottom: 8px; }
    .events-page .view-tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 12px;
      padding: 6px 9px;
      margin-bottom: 8px;
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--surface);
    }
    .events-page .view-tools .toolbar {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
      padding: 0;
      margin: 0;
      background: transparent;
      border: 0;
    }
    .events-page .timeline-toolbar button { min-width: 29px; }
    .events-page #range { margin-inline: 5px 0; font-variant-numeric: tabular-nums; }
    .events-page .wave-settings-body {
      flex: 1 0 100%;
      min-width: 0;
      margin-top: 4px;
      padding: 12px;
      border-top: 1px solid var(--border);
      background: var(--subtle);
      border-radius: 8px;
    }
    .events-page .wave-settings-body[hidden] { display: none; }
    .events-page .wave-settings-body .display-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
    .events-page .wave-settings-body > .analysis-notes { margin: 0; }
    .events-page .chart-area select#display-mode { max-width: 100%; padding: 4px 8px; }
    .events-page .scan-toolbar { align-items: center; }
    .events-page .scan-toolbar #scan-window,
    .events-page .event-shell > header > .file { background: var(--primary); border-color: var(--primary); color: white; }
    .events-page .scan-toolbar #scan-window:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); color: white; }
    .events-page :is(.file, #scan-all, #scan-window, #go, #event-form button[type=submit], #package-save, #export-package):hover {
      background: var(--primary-hover) !important;
      border-color: var(--primary-hover);
    }
    .events-page :is(input, select, textarea, button, a, summary):focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    .events-page .wave-panel .group-title {
      display: flex;
      justify-content: flex-start;
      gap: 5px 10px;
      padding: 7px 10px;
    }
    .events-page .group-title .legend { flex: 1 1 180px; gap: 4px; min-width: 0; }
    .events-page .group-title .channel-chip {
      min-width: 0;
      padding: 2px 6px;
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .events-page .group-title .channel-chip::before {
      content: '';
      flex: 0 0 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--channel-color);
    }
    .events-page .group-title .axis-note { margin-inline-start: auto; white-space: normal; }
    .events-page .group-controls { display: contents; }
    .events-page .group-controls > summary {
      list-style: none;
      margin-inline-start: auto;
      padding: 3px 7px;
      border-radius: 6px;
      color: var(--primary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    .events-page .group-controls > summary::-webkit-details-marker { display: none; }
    .events-page .group-controls > summary::after { content: ' \u25BE'; }
    .events-page .group-controls[open] > summary::after { content: ' \u25B4'; }
    .events-page .group-controls > summary:hover,
    .events-page .group-controls[open] > summary { background: var(--selected); }
    .events-page .group-controls::details-content { flex: 0 0 100%; }
    .events-page .group-channel-settings {
      padding-block: 3px;
      border-top: 1px solid var(--border);
    }
    .events-page .group-channel-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 8px;
      padding: 3px 0;
      font-size: 12px;
      font-weight: normal;
    }
    .events-page .group-channel-row > span { flex: 1 1 150px; }
    .events-page .group-channel-row select { max-width: min(100%, 160px); }
    .events-page .group-channel-row :is(select, button) { padding: 2px 6px; }
    .events-page .event-panel .batch-controls select { display: block; width: 100%; margin-top: 4px; }
    .events-page .batch-controls { padding: 2px 4px 8px; border-bottom: 1px solid var(--border); }
    .events-page .event-panel-backdrop { z-index: 90; }
    .events-page { --results-sticky-top: 76px; }
    .analysis-embedded.events-page { --results-sticky-top: 4px; }
    .events-page .results-switch-row {
      position: sticky;
      top: var(--results-sticky-top);
      z-index: 101;
      display: flex;
      justify-content: flex-end;
      margin-bottom: 6px;
      pointer-events: none;
    }
    .events-page .results-switch-row .event-toggle {
      margin: 0;
      background: var(--surface);
      border-color: var(--border);
      color: var(--primary);
      box-shadow: none;
      pointer-events: auto;
    }
    .events-page .results-switch-row .event-toggle[aria-expanded=true] {
      background: var(--selected);
      border-color: var(--selected-border);
    }
    @media (min-width: 1101px) {
      .events-page .workspace > .event-panel { top: calc(var(--results-sticky-top) + 38px); }
    }
    @media (max-width: 1100px) {
      .events-page .workspace > .event-panel {
        top: var(--results-drawer-top, calc(var(--results-sticky-top) + 38px));
        height: auto;
        min-height: 0;
        max-height: none;
      }
    }
    @media (max-width: 680px) {
      .events-page:not(.analysis-embedded) { --results-sticky-top: 68px; }
    }
    .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle:not([hidden]) {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 5px 10px;
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      box-shadow: none;
      white-space: nowrap;
    }
    .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle::after {
      content: '';
      width: 6px;
      height: 6px;
      border: solid currentColor;
      border-width: 0 1.5px 1.5px 0;
      transform: translateY(-2px) rotate(45deg);
    }
    .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle:hover:not(:disabled) {
      border-color: var(--border);
      background: var(--subtle);
      color: var(--primary);
    }
    .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle[aria-expanded=true] {
      border-color: var(--border);
      background: var(--selected);
      color: var(--primary);
    }
    .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle[aria-expanded=true]::after {
      transform: translateY(1px) rotate(225deg);
    }
    .events-page .panel-collapse {
      min-width: 28px;
      padding: 1px 7px;
      color: var(--primary);
      font-size: 16px;
      line-height: 1.5;
      box-shadow: none;
    }
    .events-page .event-panel .event-current-mode {
      margin: 0 0 6px;
      padding: 7px 0;
      border: 0;
      background: transparent;
    }
    .events-page .event-panel .event-status-tools {
      padding: 0 0 6px;
      border: 0;
    }
    .events-page .event-panel .event-summary:empty,
    .events-page .event-panel #scan-view-note:empty { display: none; }
    .events-page .event-panel .event-row { align-items: flex-start; }
    .events-page .event-panel .event-row .event-text { min-width: 0; }
    .events-page .event-panel .event-row > button { flex: 0 0 auto; }
    @media (max-width: 480px) {
      .events-page :is(.timeline-toolbar, .results-switch-row) > .view-toggle:not([hidden]) { padding-inline: 7px; }
    }

    /* Use the desktop text scale in the standalone and embedded waveform views. */
    .events-page {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 22px;
    }
    .events-page :is(button, input, select, textarea, .file),
    .events-page input:not([type=checkbox]):not([type=file]),
    .events-page .channel-chip select,
    .events-page .event-panel select {
      font-family: inherit;
      font-size: 13px;
      font-weight: 400;
      line-height: 20px;
    }
    .events-page :is(.file, #scan-all) { font-weight: 500; }
    .events-page :is(.toolbar, .display-toolbar, .scan-options-body) label { font-size: 13px; line-height: 20px; }
    .events-page .scan-toolbar > strong { font-size: 14px; font-weight: 600; line-height: 22px; }
    .events-page .nav-item {
      font-size: 13px;
      font-weight: 500;
      line-height: 20px;
    }
    .events-page :is(.axis-note, .sidebar-foot, .event-summary, .event-row small, .event-message) {
      font-size: 12px;
      line-height: 18px;
    }
    .events-page .annotation-dialog,
    .events-page .annotation-dialog :is(input, select, textarea) {
      font: inherit;
    }
    .events-page .annotation-dialog h2 {
      font-size: 16px;
      font-weight: 600;
      line-height: 24px;
    }

    /* File navigation takes only the space it needs. The channel list uses the remaining height. */
    .events-page .file-library {
      flex: 0 1 auto;
      min-width: 0;
      min-height: 0;
      padding: 0 10px 10px;
    }
    .events-page .channel-sidebar .sidebar-head {
      display: flex;
      gap: 6px;
    }
    .events-page .channel-sidebar .sidebar-head strong { font-size: 13px; }
    .events-page .channel-sidebar .sidebar-head small { margin-inline-start: auto; }
    .events-page #file-list {
      flex: 0 1 auto;
      max-height: min(156px, 24dvh);
      margin: 5px 0;
      padding: 2px;
      overflow: hidden auto;
      overscroll-behavior-y: contain;
      scrollbar-gutter: auto;
      scrollbar-width: thin;
    }
    .events-page #file-list:empty { margin: 0; padding: 0; }
    .events-page #file-list:empty + small { display: none; }
    .events-page .library-row { min-width: 0; align-items: center; gap: 2px; }
    .events-page .library-row .library-file {
      flex: 1 1 0;
      min-width: 0;
      min-height: 32px;
      padding: 4px 7px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-color: transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--text);
      box-shadow: none;
      font-size: 12px;
    }
    .events-page .library-row .library-file:hover:not(:disabled) { background: var(--subtle); }
    .events-page .library-row .library-file[aria-pressed=true],
    .events-page .library-row .library-file[aria-pressed=true]:hover:not(:disabled) {
      background: var(--selected);
      border-color: var(--selected-border);
      color: var(--primary);
      font-weight: 600;
    }
    .events-page .library-row .library-close,
    .events-page .file-library .panel-collapse {
      display: grid;
      place-items: center;
      flex: 0 0 26px;
      min-width: 26px;
      width: 26px;
      height: 26px;
      padding: 0;
      border-color: transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      font-size: 16px;
    }
    .events-page .library-row .library-close:hover:not(:disabled) { background: #fff1f2; border-color: #f1d7da; color: #a62f3e; }
    .events-page .file-library .panel-collapse:hover:not(:disabled) { background: var(--surface); border-color: var(--border); color: var(--text); }
    .events-page .library-row button:focus-visible { outline-offset: -2px; }
    .events-page .sidebar-tools { align-items: center; }
    .events-page .channel-sidebar #channels { scrollbar-width: thin; }
    .events-page .channel-sidebar #channels label:has(input:checked) { background: var(--selected); color: var(--primary); }

    /* Keep the panel control at the left edge of the heading in both open and closed states. */
    .events-page .event-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      min-width: 0;
      gap: 8px 13px;
    }
    .events-page .event-heading > div { min-width: 0; }
    .events-page .event-heading #toggle-channels {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 32px;
      padding: 4px 9px;
      border-radius: 8px;
      color: var(--muted);
      white-space: nowrap;
      box-shadow: 0 1px 2px #20232a09;
    }
    .events-page .event-heading #toggle-channels::before {
      content: '';
      width: 13px;
      height: 10px;
      border: 1.4px solid currentColor;
      border-radius: 2px;
      background: linear-gradient(90deg, transparent 30%, currentColor 30% 41%, transparent 41%);
    }
    .events-page .event-heading #toggle-channels[aria-expanded=true] {
      border-color: var(--selected-border);
      background: var(--selected);
      color: var(--primary);
    }
    .events-page .event-shell > header h1 {
      line-height: 1.32;
      letter-spacing: normal;
      font-weight: 600;
    }

    /* Quiet surfaces and one accent keep the traces visually dominant. */
    .events-page,
    .events-page.analysis-embedded { background: var(--subtle); }
    .events-page .record-context,
    .events-page.analysis-embedded .record-context {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      padding: 7px 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
    }
    .events-page .record-context .info {
      min-width: 0;
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
      font-variant-numeric: tabular-nums;
    }
    .events-page .record-context .info > span { min-width: 0; }
    .events-page .record-context .info > span:first-child { color: var(--text); font-weight: 600; }
    .events-page .view-tools,
    .events-page .scan-toolbar,
    .events-page :is(.channel-sidebar, .event-panel, .wave-panel, .wave-overview) {
      border-radius: 12px;
      box-shadow: 0 1px 3px #20232a0a;
    }
    .events-page .view-tools { container-type: inline-size; justify-content: normal; }
    .events-page .view-tools .timeline-toolbar { flex: 1 1 100%; min-width: 0; }
    .events-page .timeline-toolbar > button:not(.view-toggle) { min-width: 30px; padding: 4px 8px; border-radius: 7px; }
    .events-page .timeline-toolbar > .view-toggle { margin-inline-start: auto; }
    .events-page #range { color: var(--muted); }
    @container (max-width: 550px) {
      .events-page #range:not(:empty) { order: 1; flex-basis: 100%; margin-inline: 0; }
    }
    .events-page .scan-toolbar,
    .events-page.analysis-embedded .scan-toolbar { background: var(--surface); }
    .events-page .scan-toolbar #scan-window { background: var(--surface) !important; color: var(--primary) !important; border-color: var(--selected-border); }
    .events-page .scan-toolbar #scan-window:hover:not(:disabled) { background: var(--selected) !important; color: var(--primary) !important; border-color: var(--selected-border); }
    .events-page .event-panel-head { background: var(--subtle); }
    .events-page .wave-panel .group-title { background: var(--surface); }
    .events-page .group-title .channel-chip { background: var(--surface); border-color: var(--border); }
    @media (min-width: 761px) {
      .analysis-embedded.events-page { --analysis-sidebar-width: clamp(188px, 21vw, 220px); }
      .analysis-embedded.events-page .workspace > .channel-sidebar {
        border-radius: 0;
        box-shadow: none;
      }
    }
    `;

    // somnus-waveform:D:\VVFLY\SomnusNext\event_detection\viewer.js
    function mount(document2, window2, fetch2, AnnotationModel, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout, setInterval, clearInterval, URL2) {
      "use strict";
      let meta, view = [0, 1], data = {}, overview = [], selected = [], hover = null;
      let controller, serial = 0, timer, drag = null, overviewDrag = null, raf = 0;
      let cache = null, overviewImage = null, baseSecond = 0, generation = 0;
      let groups = [], movingChannel = null;
      let displayMode = "engineering";
      let annotations = null;
      let fileLibrary = [], activeLibraryId = null, librarySerial = 0, fileSwitching = false;
      const embeddedAnalysis = Boolean(window2.parent && window2.parent !== window2 && new URLSearchParams(window2.location?.search || "").get("embedded") === "1");
      let embeddedAnalysisVisible = true, embeddedLayoutFrame = 0;
      document2.body?.classList?.toggle("analysis-embedded", embeddedAnalysis);
      let serverRevision = 0, eventSyncReady = false, eventSaving = false;
      const eventColors = { "\u7591\u4F3C\u6682\u505C": "#ce5362", "\u7591\u4F3C\u4F4E\u901A\u6C14": "#9b69be", "\u6F0F\u6C14": "#dc9a28", "\u6CE2\u5F62\u5F02\u5E38": "#328ca5", "\u4F2A\u8FF9/\u5E72\u6270": "#728398", "\u5176\u4ED6": "#619c59" };
      Object.assign(eventColors, { "\u547C\u5438\u6CE2\u52A8\u51CF\u5F31": "#ce5362", "\u603B\u6F0F\u6C14\u5347\u9AD8": "#dc9a28", "\u6570\u636E\u7F3A\u5931": "#728398", "\u4FE1\u53F7\u5F02\u5E38": "#9b69be" });
      Object.assign(eventColors, { "\u6D41\u91CF\u6CE2\u52A8\u8FD1\u6D88\u5931\u5019\u9009": "#be394c", "\u6D41\u91CF\u6CE2\u52A8\u51CF\u5F31\u5019\u9009": "#9460b0" });
      Object.assign(eventColors, { "\u516C\u53F8\u6682\u505C\u5019\u9009": "#b53c54", "\u516C\u53F8\u4F4E\u901A\u6C14\u5019\u9009": "#a66abd" });
      Object.assign(eventColors, { "\u6D4B\u8BD5\u8FD1\u6D88\u5931\u5019\u9009": "#b6345a", "\u6D4B\u8BD5\u51CF\u5F31\u5019\u9009": "#7054b3" });
      Object.assign(eventColors, { "\u547C\u5438\u6682\u505C\u5019\u9009": "#d7476a", "\u4F4E\u901A\u6C14\u5019\u9009": "#5c67c4" });
      Object.assign(eventColors, { "\u5F3A\u5EA6\u663E\u8457\u4E0B\u964D\u5019\u9009": "#b6345a", "\u5F3A\u5EA6\u51CF\u5F31\u5019\u9009": "#237d9f" });
      const detectionTypes = { adaptive_multifeature: ["\u6D4B\u8BD5\u8FD1\u6D88\u5931\u5019\u9009", "\u6D4B\u8BD5\u51CF\u5F31\u5019\u9009", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"], adaptive_test: ["\u6D4B\u8BD5\u8FD1\u6D88\u5931\u5019\u9009", "\u6D4B\u8BD5\u51CF\u5F31\u5019\u9009", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"], engineering: ["\u547C\u5438\u6CE2\u52A8\u51CF\u5F31", "\u603B\u6F0F\u6C14\u5347\u9AD8", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"], device_candidates: ["\u6D41\u91CF\u6CE2\u52A8\u8FD1\u6D88\u5931\u5019\u9009", "\u6D41\u91CF\u6CE2\u52A8\u51CF\u5F31\u5019\u9009", "\u603B\u6F0F\u6C14\u5347\u9AD8", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"], company_rules: ["\u516C\u53F8\u6682\u505C\u5019\u9009", "\u516C\u53F8\u4F4E\u901A\u6C14\u5019\u9009", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"] };
      let chosenDetectionTypes = new Set(detectionTypes.device_candidates), visibleEventTypes = new Set(Object.keys(eventColors));
      detectionTypes.dynamic_baseline = ["\u5F3A\u5EA6\u663E\u8457\u4E0B\u964D\u5019\u9009", "\u5F3A\u5EA6\u51CF\u5F31\u5019\u9009", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"];
      detectionTypes.dynamic_baseline_v2 = [...detectionTypes.dynamic_baseline];
      detectionTypes.dynamic_baseline_v3 = [...detectionTypes.dynamic_baseline];
      detectionTypes.patient_flow_v4 = ["\u547C\u5438\u6682\u505C\u5019\u9009", "\u4F4E\u901A\u6C14\u5019\u9009", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38"];
      function isPatientFlow(profile) {
        return profile === "patient_flow_v4";
      }
      function isBaseline(profile) {
        return ["dynamic_baseline", "dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(profile);
      }
      function isOptimized(profile) {
        return ["dynamic_baseline_v2", "dynamic_baseline_v3"].includes(profile);
      }
      function optimizedAvailable(profile) {
        return profile === "dynamic_baseline_v3" ? meta.dynamic_baseline_optimized_v3_version === "dynamic-baseline-optimized-v3-configurable-v22" : meta.dynamic_baseline_optimized_version === "dynamic-baseline-optimized-v2";
      }
      let activeBaselineProfile = "dynamic_baseline", optimizedInitialized = false, v3Initialized = false;
      let activeAutomaticProfile = "device_candidates";
      const primaryProfiles = ["company_rules", "dynamic_baseline_v3", "patient_flow_v4"];
      let patientInitialized = false, previousDetectionProfile = null;
      const profilePreferences = /* @__PURE__ */ new Map();
      function selectDetectionProfile(profile, history = false) {
        const select = $("scan-profile");
        for (const option of [...select.options || []]) if (option.dataset?.legacy === "true" && primaryProfiles.includes(profile)) option.remove?.();
        if (history && !primaryProfiles.includes(profile) && ![...select.options || []].some((o) => o.value === profile)) {
          const option = document2.createElement("option");
          option.value = profile;
          option.textContent = "\u5386\u53F2\u7B97\u6CD5\uFF08\u5DF2\u505C\u7528\u68C0\u6D4B\uFF09";
          option.hidden = true;
          option.disabled = true;
          option.dataset.legacy = "true";
          select.append(option);
        }
        select.value = profile;
      }
      const scanViews = /* @__PURE__ */ new Map();
      const transientAnnotationStorage = { getItem() {
        return null;
      }, setItem() {
      } };
      function usesSessionEvents(recording = meta) {
        return recording?.event_storage === "session";
      }
      function resultGroupForProfile(profile) {
        return isBaseline(profile) ? "baseline" : isAdaptive(profile) ? "adaptive" : profile === "company_rules" ? "company" : "automatic";
      }
      function currentScanView() {
        const v = scanViews.get(meta?.file_id);
        return v?.profile === $("scan-profile").value ? v : null;
      }
      function actualEventProfile(e) {
        return e.detection_profile || (e.type?.startsWith("\u516C\u53F8") || (e.note || "").includes("\u516C\u53F8\u89C4\u5219\u8BD5\u9A8C") ? "company_rules" : e.type?.startsWith("\u6D41\u91CF\u6CE2\u52A8") || (e.note || "").includes("machine-flow-candidates-v2") ? "device_candidates" : "engineering");
      }
      function eventProfileForView(e) {
        const v = currentScanView();
        return v?.ids.has(e.id) ? v.profile : actualEventProfile(e);
      }
      function matchesScanView(e, group) {
        const v = currentScanView();
        return !v || group === "manual" || group !== resultGroupForProfile(v.profile) || v.ids.has(e.id);
      }
      function eventDuration(e) {
        return e.detection_min_duration ?? e.evidence?.minimum_duration ?? 10;
      }
      function updateBaselineControls() {
        const patient = isPatientFlow($("scan-profile").value), v3 = $("scan-profile").value === "dynamic_baseline_v3", configurable = v3 || patient;
        if (patient) {
          $("scan-duration").value = 10;
          $("baseline-method").value = "absolute_mean";
        }
        $("baseline-method").disabled = patient || scanning;
        for (const option of $("baseline-method").options || []) if (option.value === "absolute_mean") option.textContent = patient ? "\u60A3\u8005\u6D41\u91CF\u7EDD\u5BF9\u503C\u5E45\u5EA6" : "\u7EDD\u5BF9\u503C\u5747\u503C\xF72\uFF08\u672A\u53BB\u80CC\u666F\uFF09";
        $("baseline-duration").disabled = patient || scanning;
        $("baseline-duration").ariaLabel = patient ? "\u6700\u77ED\u6301\u7EED\u56FA\u5B9A10\u79D2" : "\u6700\u77ED\u6301\u7EED5\u81F310\u79D2";
        for (const option of $("baseline-window").options || []) option.hidden = option.disabled = !configurable && ![2, 5, 8].includes(Number(option.value));
        if (!configurable && ![2, 5, 8].includes(Number($("baseline-window").value))) $("baseline-window").value = "5";
        $("baseline-duration").hidden = !configurable;
        $("scan-duration").hidden = configurable;
        $("baseline-duration").value = String(Number($("scan-duration").value) || 10);
        if (v3) $("optimized-v3-rule-info").textContent = "\u4F18\u5316v3\uFF1A\u68C0\u6D4B\u7A97\u53E3" + $("baseline-window").value + "\u79D2\uFF0C\u6700\u77ED\u6301\u7EED" + $("scan-duration").value + "\u79D2\u3002\u663E\u8457\u4E0B\u964D\uFF1A1\u79D2\u590D\u6838\u5269\u4F59<25%\u8FDE\u7EED\u8FBE\u6807\u5E76\u6709\u4E3B\u7A97\u53E3\u4F50\u8BC1\uFF1B\u51CF\u5F31\uFF1A\u6240\u9009\u4E3B\u7A97\u53E3\u5269\u4F59<50%\u8FDE\u7EED\u8FBE\u6807\uFF0C1\u79D2\u5C0F\u5CF0\u4E0D\u6253\u65AD\u5F31\u4E8B\u4EF6\u3002\u5F31\u4E8B\u4EF6\u4ECE\u7A97\u53E3\u672B\u7AEF\u8BA1\u65F6\u3002\u603B\u6F0F\u6C14\u53D8\u5316\u4EC5\u4F5C\u63D0\u793A\uFF0C\u4E0D\u6E05\u7A7A\u53C2\u8003\uFF1B\u65E0\u6548\u6570\u636E\u3001\u7F3A\u53E3\u53CA\u72B6\u6001\u53D8\u5316\u4ECD\u91CD\u7F6E\u3002";
      }
      async function showScanBatch(runId, restore = false) {
        if (!meta || !runId) return;
        const fileId = meta.file_id;
        const snapshot = await api("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId, run_id: runId, kind: "automatic" }) });
        if (meta?.file_id !== fileId) return;
        const config = snapshot.settings;
        if (restore) {
          selectDetectionProfile(config.profile, true);
          $("scan-profile").onchange();
          if (isBaseline(config.profile)) {
            $("baseline-method").value = config.method;
            $("baseline-window").value = String(config.window_seconds);
          }
          $("scan-duration").value = config.min_duration;
          if (Number.isFinite(config.reduction_ratio)) $("scan-ratio").value = Math.round(config.reduction_ratio * 100);
          if (isAdaptive(config.profile)) $("adaptive-version").value = config.version;
          chosenDetectionTypes = new Set(config.event_types || detectionTypes[config.profile]);
          renderDetectionChoices();
          if (config.profile === "company_rules") $("amplitude-source").value = config.flow_source || "pressure_q";
          updateBaselineControls();
          pruneProfileChannels();
        }
        scanViews.set(fileId, { runId, profile: config.profile, config, ids: new Set(snapshot.events.map((e) => snapshot.event_links?.[e.id] || e.id)) });
        $("baseline-all-configs").checked = false;
        visibleEventTypes = /* @__PURE__ */ new Set([...config.event_types, ...(annotations?.items || []).filter((e) => scanViews.get(fileId).ids.has(e.id)).map((e) => e.type)]);
        setResultGroup(resultGroupForProfile(config.profile));
        renderDisplayChoices();
        refreshEventVisibility();
      }
      function baselineMethodLabel(method, profile = $("scan-profile").value) {
        if (isPatientFlow(profile) && method === "absolute_mean") return "\u60A3\u8005\u6D41\u91CF\u7EDD\u5BF9\u503C\u5E45\u5EA6";
        return { detrended_abs: "\u53BB\u80CC\u666F\u7EDD\u5BF9\u503C\u5747\u503C", centered_rms: "\u7A97\u53E3\u53BB\u5747\u503CRMS", absolute_mean: "\u7EDD\u5BF9\u503C\u5747\u503C\xF72" }[method] || method;
      }
      function prepareBaselineProfile(profile) {
        if (!isBaseline(profile)) return;
        activeBaselineProfile = profile;
        if (isPatientFlow(profile)) {
          if (!patientInitialized) {
            $("baseline-window").value = "5";
            patientInitialized = true;
          }
          $("baseline-method").value = "absolute_mean";
          return;
        }
        const optimized = isOptimized(profile);
        for (const option of $("baseline-method").options || []) if (option.value === "detrended_abs") option.hidden = option.disabled = !optimized;
        if (profile === "dynamic_baseline_v2" && !optimizedInitialized) {
          $("baseline-method").value = "detrended_abs";
          $("baseline-window").value = "5";
          optimizedInitialized = true;
        }
        if (profile === "dynamic_baseline_v3" && !v3Initialized) {
          $("baseline-method").value = "detrended_abs";
          $("baseline-window").value = "8";
          v3Initialized = true;
        }
        if (!optimized && $("baseline-method").value === "detrended_abs") $("baseline-method").value = "centered_rms";
      }
      function baselineArgs() {
        return { dynamic_method: isPatientFlow($("scan-profile").value) ? "absolute_mean" : $("baseline-method").value || "centered_rms", window_seconds: Number($("baseline-window").value) || 2 };
      }
      function amplitudeSource() {
        return $("amplitude-source").value === "csv_flow" ? "csv_flow" : "pressure_q";
      }
      const multiNames = ["\u591A\u7279\u5F81\u5E45\u5EA6A\uFF085\u79D2\u9C81\u68D2\uFF09", "\u591A\u7279\u5F81\u53C2\u8003B", "\u591A\u7279\u5F81\u8FD1\u6D88\u5931\u95E8\u9650", "\u591A\u7279\u5F81\u51CF\u5F31\u95E8\u9650", "\u591A\u7279\u5F81\u5269\u4F59\u6BD4\u4F8B", "\u591A\u7279\u5F81\u4E0B\u964D\u767E\u5206\u6BD4", "\u591A\u7279\u5F81\u566A\u58F0\u4EE3\u7406\uFF08\u672A\u6807\u5B9A\uFF09"];
      function dynamicNames(window3) {
        return ["\u5F3A\u5EA6", "\u53C2\u8003", "25%\u95E8\u9650", "50%\u95E8\u9650", "\u5269\u4F59\u6BD4\u4F8B"].map((s) => "\u52A8\u6001" + window3 + "\u79D2" + s);
      }
      const allDynamicNames = [...dynamicNames(2), ...dynamicNames(5), ...dynamicNames(8)];
      function optimizedNames(window3, profile = "dynamic_baseline_v2") {
        return ["\u5F3A\u5EA6", "\u53C2\u8003", "25%\u95E8\u9650", "50%\u95E8\u9650", "\u5269\u4F59\u6BD4\u4F8B", "\u80CC\u666F\u4F30\u8BA1", "1\u79D2\u590D\u6838\u5F3A\u5EA6", "1\u79D2\u590D\u6838\u53C2\u8003"].map((n) => (profile === "dynamic_baseline_v3" ? "\u4F18\u5316v3" : "\u4F18\u5316") + window3 + "\u79D2" + n);
      }
      function patientNames(window3) {
        return ["\u5F3A\u5EA6", "\u53C2\u8003", "10%\u95E8\u9650", "70%\u95E8\u9650", "\u5269\u4F59\u6BD4\u4F8B", "1\u79D2\u5F3A\u5EA6", "1\u79D2\u53C2\u8003"].map((n) => "\u60A3\u8005\u6D41\u91CFv4" + window3 + "\u79D2" + n);
      }
      const allPatientNames = Array.from({ length: 10 }, (_, i) => i + 1).flatMap(patientNames);
      const allOptimizedNames = ["dynamic_baseline_v2", "dynamic_baseline_v3"].flatMap((p) => (p === "dynamic_baseline_v3" ? Array.from({ length: 10 }, (_, i) => i + 1) : [2, 5, 8]).flatMap((w) => optimizedNames(w, p)));
      function dynamicMethod() {
        return baselineArgs().dynamic_method;
      }
      const defaultPlotGroups = [["\u6C14\u538B1", "\u6C14\u538B2", "\u6C14\u538B1\u2212\u6C14\u538B2\uFF08\u5DEE\u538B\uFF09", "\u63A7\u5236\u538B\u529B", "\u6CBB\u7597\u538B"], ["\u6D41\u91CF"], ["\u6F0F\u6C14\u91CF"]];
      const analysisDerivedNames = [...allPatientNames, ...allDynamicNames, ...allOptimizedNames, ...multiNames, "\u6D4B\u8BD5\u5E45\u5EA6A\uFF085\u79D2\u9C81\u68D2\uFF09", "\u516C\u53F8\u516C\u5F0FQ\uFF08\u8BD5\u9A8C\uFF09", "\u516C\u53F8A\uFF085\u79D2\u6781\u5DEE\uFF09", "\u6D41\u91CF\u6CE2\u52A8\u5E45\u5EA6A\uFF085\u79D2\u6781\u5DEE\uFF09"];
      function profileChannels() {
        const profile = $("scan-profile").value, b = baselineArgs();
        return isPatientFlow(profile) ? ["\u6D41\u91CF", ...patientNames(b.window_seconds)] : isBaseline(profile) ? ["\u6D41\u91CF", ...isOptimized(profile) ? optimizedNames(b.window_seconds, profile).filter((n, i) => i !== 5 || b.dynamic_method === "detrended_abs") : dynamicNames(b.window_seconds)] : ["company_rules", "adaptive_test", "adaptive_multifeature"].includes(profile) ? amplitudeChannels() : ["\u6D41\u91CF"];
      }
      function recommendedChannels() {
        const common = ["\u6C14\u538B1", "\u6C14\u538B2", "\u6C14\u538B1\u2212\u6C14\u538B2\uFF08\u5DEE\u538B\uFF09", "\u63A7\u5236\u538B\u529B", "\u6D41\u91CF", "\u6F0F\u6C14\u91CF", "\u538B\u529B", "\u6CBB\u7597\u538B"];
        const names = [.../* @__PURE__ */ new Set([...common, ...profileChannels()])].filter((n) => meta?.channels?.includes(n));
        return names.length ? names : (meta?.channels || []).slice(0, 3);
      }
      function pruneProfileChannels() {
        if (!meta) return;
        const relevant = new Set(profileChannels()), before = selected.join("|");
        selected = selected.filter((n) => !analysisDerivedNames.includes(n) || relevant.has(n));
        groups = groups.map((g) => g.filter((n) => selected.includes(n))).filter((g) => g.length);
        reconcileGroups();
        $("channels").querySelectorAll("input").forEach((c) => c.checked = selected.includes(c.dataset.name));
        filterChannels();
        if (before !== selected.join("|")) {
          cache = null;
          data = {};
          render();
          loadWave(true);
        }
      }
      function isAdaptive(profile) {
        return ["adaptive_test", "adaptive_multifeature"].includes(profile);
      }
      function multiPlotArgs() {
        return { test_duration: Number($("scan-duration").value) || 7, test_ratio: Number($("scan-ratio").value) / 100 || 0.5 };
      }
      function amplitudeChannels() {
        if ($("scan-profile").value === "adaptive_multifeature") return ["\u6D41\u91CF", ...multiNames];
        if ($("scan-profile").value === "adaptive_test") return ["\u6D41\u91CF", "\u6D4B\u8BD5\u5E45\u5EA6A\uFF085\u79D2\u9C81\u68D2\uFF09"];
        return amplitudeSource() === "csv_flow" ? ["\u6D41\u91CF", "\u6D41\u91CF\u6CE2\u52A8\u5E45\u5EA6A\uFF085\u79D2\u6781\u5DEE\uFF09"] : ["\u516C\u53F8\u516C\u5F0FQ\uFF08\u8BD5\u9A8C\uFF09", "\u516C\u53F8A\uFF085\u79D2\u6781\u5DEE\uFF09"];
      }
      function testEventVersion(e) {
        return e.detection_version || (e.note || "").match(/adaptive-flow-test-v[\w-]+/)?.[0] || "unknown";
      }
      function matchesResultGroup(e, group) {
        const version = $("adaptive-version").value, b = baselineArgs(), profile = $("scan-profile").value, origin = eventProfileForView(e);
        return eventResultGroup(e) === group && matchesScanView(e, group) && (group !== "automatic" || !["engineering", "device_candidates"].includes(profile) || origin === profile) && (group !== "company" || (e.detection_input || "pressure_q") === amplitudeSource()) && (group !== "adaptive" || !isAdaptive(profile) || origin === profile) && (group !== "adaptive" || !version || version === "all" || testEventVersion(e) === version) && (group !== "baseline" || origin === activeBaselineProfile && ($("baseline-all-configs").checked || e.detection_method === b.dynamic_method && e.detection_window_seconds === b.window_seconds && (!["dynamic_baseline_v3", "patient_flow_v4"].includes(origin) || eventDuration(e) === Number($("scan-duration").value))));
      }
      let activeResultGroup = "automatic";
      const resultVisibility = /* @__PURE__ */ new Map();
      function eventResultGroup(e) {
        if (e.source && e.source !== "detector") return "manual";
        if (isBaseline(e.detection_profile)) return "baseline";
        if (isAdaptive(e.detection_profile)) return "adaptive";
        return e.detection_profile === "company_rules" || !e.detection_profile && (e.type.startsWith("\u516C\u53F8") || (e.note || "").includes("\u516C\u53F8\u89C4\u5219\u8BD5\u9A8C")) ? "company" : "automatic";
      }
      function displayTypesForCurrentGroup() {
        const base = activeResultGroup === "baseline" ? detectionTypes[activeBaselineProfile] || detectionTypes.dynamic_baseline : activeResultGroup === "adaptive" ? detectionTypes.adaptive_test : activeResultGroup === "company" ? detectionTypes.company_rules : activeResultGroup === "automatic" ? [...detectionTypes.engineering, ...detectionTypes.device_candidates] : Object.keys(eventColors);
        return [.../* @__PURE__ */ new Set([...base, ...(annotations?.items || []).filter((e) => matchesResultGroup(e, activeResultGroup)).map((e) => e.type)])];
      }
      function setResultGroup(group) {
        if (!["automatic", "company", "manual", "adaptive", "baseline"].includes(group)) return;
        $("device-metrics").hidden = group !== "automatic";
        $("adaptive-version-label").hidden = group !== "adaptive";
        $("baseline-history-label").hidden = group !== "baseline";
        if (group !== activeResultGroup) {
          resultVisibility.set(activeResultGroup, [...visibleEventTypes]);
          activeResultGroup = group;
          const saved = resultVisibility.get(group);
          visibleEventTypes = new Set(saved || Object.keys(eventColors));
        }
        renderDisplayChoices();
        refreshEventVisibility();
      }
      const $ = (id) => document2.getElementById(id);
      const waveChartFont = window2.getComputedStyle?.(document2.body)?.getPropertyValue("--wave-chart-font").trim() || "400 12px Microsoft YaHei";
      function displayText(value) {
        return String(value).replaceAll("\u516C\u53F8\u516C\u5F0FQ", "\u538B\u529B\u4F30\u7B97Q").replaceAll("\u516C\u53F8A", "\u6CE2\u52A8\u5E45\u5EA6A").replaceAll("\u516C\u53F8\u5224\u5B9A\u540C\u6E90A", "\u68C0\u6D4B\u7528A").replaceAll("\u516C\u53F8\u89C4\u5219", "\u5E45\u5EA6\u89C4\u5219").replaceAll("\u516C\u53F8\u6682\u505C", "\u5E45\u5EA6\u89C4\u5219\u6682\u505C").replaceAll("\u516C\u53F8\u4F4E\u901A\u6C14", "\u5E45\u5EA6\u89C4\u5219\u4F4E\u901A\u6C14").replaceAll("\u516C\u53F8", "\u5E45\u5EA6");
      }
      function channelLabel(name) {
        if (name === "\u6D41\u91CF") return "\u6D41\u91CF \xB7 \u60A3\u8005\u547C\u5438\u6D41\u91CF [L/min]";
        const unit = meta?.channel_units?.[name], role = meta?.channel_roles?.[name];
        return displayText(name + (!multiNames.includes(name) && !allDynamicNames.includes(name) && !allOptimizedNames.includes(name) && role && role !== name ? " \xB7 " + role : "") + (unit ? " [" + unit + "]" : ""));
      }
      const colors = ["#087e8b", "#4263c7", "#b47924", "#9871b5", "#d04b59", "#538c36", "#b65191", "#397eaa"];
      function channelColor(name) {
        const reference = { "\u6C14\u538B1": "#4472c4", "\u6C14\u538B2": "#ed7d31", "\u6C14\u538B1\u2212\u6C14\u538B2\uFF08\u5DEE\u538B\uFF09": "#a5a5a5", "\u63A7\u5236\u538B\u529B": "#edaf00", "\u6CBB\u7597\u538B": "#8752a3" };
        return reference[name] || colors[Math.max(0, meta.channels.indexOf(name)) % colors.length];
      }
      function selectionKey() {
        return selected.join("|") + (displayMode === "raw" ? "" : "|engineering") + (selected.some((n) => multiNames.includes(n)) ? "|" + JSON.stringify(multiPlotArgs()) : "") + (selected.some((n) => allDynamicNames.includes(n) || allOptimizedNames.includes(n) || allPatientNames.includes(n)) ? "|dynamic:" + dynamicMethod() + "|profile:" + $("scan-profile").value : "") + (selected.some((n) => n.startsWith("\u4F18\u5316v3")) ? "|duration:" + Number($("scan-duration").value) : "");
      }
      function filterChannels() {
        const query = $("channel-search").value.trim().toLowerCase(), only = $("selected-only").checked, all = $("show-all-channels").checked, scope = /* @__PURE__ */ new Set([...recommendedChannels(), ...selected]);
        let shown = 0;
        for (const label of $("channels").children) {
          const checkbox = label.querySelector("input"), name = checkbox.dataset.name;
          label.hidden = !all && !query && !scope.has(name) || ![name, displayText(name)].some((n) => n.toLowerCase().includes(query)) || only && !checkbox.checked;
          if (!label.hidden) shown++;
        }
        $("channel-count").textContent = "\u5DF2\u9009 " + selected.length + " \xB7 \u663E\u793A " + shown + " \u9879";
        $("channel-empty").hidden = shown > 0;
      }
      function channelSelectionChanged() {
        selected = [...$("channels").querySelectorAll("input:checked")].map((x) => x.dataset.name);
        filterChannels();
        cache = null;
        data = {};
        render();
        loadWave(true);
      }
      function reconcileGroups() {
        const seen = /* @__PURE__ */ new Set();
        groups = groups.map((g) => g.filter((n) => selected.includes(n) && !seen.has(n) && (seen.add(n), true))).filter((g) => g.length);
        for (const name of selected) if (!seen.has(name)) {
          groups.push([name]);
          seen.add(name);
        }
      }
      function moveChannel(name, target) {
        if (!selected.includes(name)) return;
        reconcileGroups();
        const source = groups.find((g) => g.includes(name)), destination = target === null ? null : groups.find((g) => g.includes(target));
        if (!source || source === destination || target !== null && !destination) return;
        groups = groups.map((g) => g.filter((n) => n !== name)).filter((g) => g.length);
        if (destination) {
          groups.find((g) => g.includes(target)).push(name);
        } else groups.push([name]);
        hover = null;
        render();
        $("status").textContent = destination ? "\u5DF2\u53E0\u52A0\uFF1A\u5171\u7528\u65F6\u95F4\u8F74\u548C\u5DE6\u4FA7\u6570\u503C\u8F74\uFF0C\u53EF\u62D6\u52A8\u6807\u9898\u7EE7\u7EED\u7EC4\u5408" : "\u5DF2\u62C6\u4E3A\u72EC\u7ACB\u56FE";
      }
      async function api(url, options) {
        const r = await fetch2(url, options), d = await r.json();
        if (!r.ok) throw Error(d.error || r.statusText);
        return d;
      }
      function error(e) {
        $("error").textContent = e.message || String(e);
      }
      function clock(t) {
        let s = (Math.floor(baseSecond + t) % 86400 + 86400) % 86400;
        const text = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":");
        return view[1] - view[0] <= 10 ? text + "." + String(Math.floor((t % 1 + 1) % 1 * 1e3)).padStart(3, "0") : text;
      }
      function fit(c) {
        const d = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
          c.width = Math.round(w * d);
          c.height = Math.round(h * d);
        }
        const ctx = c.getContext("2d");
        ctx.setTransform(d, 0, 0, d, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return [ctx, w, h];
      }
      function bound(a, b) {
        const total = Math.max(meta.duration, 1), width = Math.min(total, Math.max(1, b - a));
        a = Math.max(0, Math.min(a, total - width));
        return [a, a + width];
      }
      function scheduleRender() {
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          render();
          drawOverview();
        });
      }
      function setView(a, b, delay = 120) {
        if (!meta) return;
        view = bound(a, b);
        hover = null;
        $("range").textContent = clock(view[0]) + " \u2014 " + clock(view[1]) + " \xB7 " + (view[1] - view[0]).toFixed(1) + " \u79D2";
        scheduleRender();
        clearTimeout(timer);
        if (!drag) timer = setTimeout(loadWave, delay);
      }
      function cacheCovers() {
        return cache && cache.key === selectionKey() && cache.start <= view[0] && cache.end >= view[1] && cache.width <= 3 * (view[1] - view[0]) && cache.pixels >= $("plots").clientWidth * 0.8;
      }
      async function loadWave(force = false) {
        if (!meta) return;
        if (!force && cacheCovers()) {
          $("status").textContent = "\u7F13\u5B58\u6D4F\u89C8 \xB7 " + selected.length + " \u4E2A\u901A\u9053";
          return;
        }
        const token = ++serial, gen = generation, key = selectionKey(), names = [...selected], width = view[1] - view[0];
        const start = Math.max(0, view[0] - width), end = Math.min(Math.max(1, meta.duration), view[1] + width), pixels = Math.max(300, Math.floor($("plots").clientWidth));
        controller?.abort();
        controller = new AbortController();
        $("status").textContent = "\u6B63\u5728\u8865\u5145\u7CBE\u7EC6\u6CE2\u5F62\u2026";
        try {
          const q = new URLSearchParams({ start, end, mode: displayMode, ...multiPlotArgs(), dynamic_method: dynamicMethod() === "detrended_abs" ? "centered_rms" : dynamicMethod(), optimized_method: dynamicMethod(), optimized_duration: Number($("scan-duration").value) || 10, pixels: Math.min(9e3, Math.ceil(pixels * (end - start) / width)) });
          names.forEach((n) => q.append("channel", n));
          if (!names.length) {
            data = {};
            cache = null;
            render();
            $("status").textContent = "\u8BF7\u9009\u62E9\u901A\u9053";
            return;
          }
          const d = await api("/api/wave?" + q, { signal: controller.signal });
          if (token !== serial || gen !== generation || key !== selectionKey()) return;
          data = d.series;
          cache = { start, end, key, width, pixels };
          scheduleRender();
          $("status").textContent = "\u5DF2\u7F13\u5B58\u5F53\u524D\u7A97\u53E3\u53CA\u76F8\u90BB\u533A\u57DF \xB7 \u62D6\u52A8\u5373\u65F6\u9884\u89C8 \xB7 " + selected.length + " \u4E2A\u901A\u9053";
        } catch (e) {
          if (e.name !== "AbortError") {
            error(e);
            $("status").textContent = "\u8BFB\u53D6\u5931\u8D25";
          }
        }
      }
      function lowerBound(points, t) {
        let a = 0, b = points.length;
        while (a < b) {
          const m = a + b >>> 1;
          if (points[m][0] < t) a = m + 1;
          else b = m;
        }
        return a;
      }
      function visibleIndices(points, range) {
        return [Math.max(0, lowerBound(points, range[0]) - 1), Math.min(points.length, lowerBound(points, range[1]) + 2)];
      }
      function paint(canvas, points, range, color, compact = false, layers = null) {
        const [ctx, w, h] = fit(canvas), L = compact ? 12 : 68, R = 16, T = 12, B = compact ? 15 : 28, pw = w - L - R, ph = h - T - B;
        const series = layers || [{ points, color }];
        const showA = !compact && series.some((layer) => ["\u516C\u53F8A\uFF085\u79D2\u6781\u5DEE\uFF09", "\u6D41\u91CF\u6CE2\u52A8\u5E45\u5EA6A\uFF085\u79D2\u6781\u5DEE\uFF09"].includes(layer.name));
        let min = Infinity, max = -Infinity, count = 0;
        for (const layer of series) {
          const [lo, hi] = visibleIndices(layer.points, range);
          for (let i = lo; i < hi; i++) {
            const p = layer.points[i];
            if (p[1] !== null && p[0] >= range[0] && p[0] <= range[1]) {
              min = Math.min(min, p[1]);
              max = Math.max(max, p[1]);
              count++;
            }
          }
        }
        if (!count) {
          min = 0;
          max = 1;
        }
        if (showA) {
          min = Math.min(min, 0);
          max = Math.max(max, 17);
        }
        if (max === min) {
          min -= 1;
          max += 1;
        }
        if (drag && !compact) {
          const limits = drag.limits.get(canvas);
          if (limits) {
            [min, max] = limits;
          } else drag.limits.set(canvas, [min, max]);
        }
        const pad = (max - min) * 0.08;
        min -= pad;
        max += pad;
        const X = (x) => L + (x - range[0]) / (range[1] - range[0]) * pw, Y = (y) => T + (max - y) / (max - min) * ph;
        ctx.font = waveChartFont;
        ctx.strokeStyle = "#e9eef3";
        ctx.fillStyle = "#74879a";
        if (!compact) {
          for (let i = 0; i < 5; i++) {
            const y = T + i * ph / 4;
            ctx.beginPath();
            ctx.moveTo(L, y);
            ctx.lineTo(w - R, y);
            ctx.stroke();
            ctx.fillText((max - i * (max - min) / 4).toFixed(1), 5, y + 4);
          }
          for (let i = 0; i < 6; i++) {
            const x = L + i * pw / 5, label = clock(range[0] + i * (range[1] - range[0]) / 5), width = ctx.measureText(label).width;
            ctx.fillText(label, Math.max(0, Math.min(w - width - 4, x - width / 2)), h - 7);
          }
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(L, T, pw, ph);
        ctx.clip();
        if (showA) {
          for (const threshold of [10, 17]) {
            ctx.strokeStyle = threshold === 10 ? "#bc5265" : "#a27824";
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(L, Y(threshold));
            ctx.lineTo(w - R, Y(threshold));
            ctx.stroke();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fillText("A=" + threshold, L + 8, Y(threshold) - 4);
          }
          ctx.setLineDash([]);
        }
        for (const [a, b] of meta.gaps) {
          if (b < range[0] || a > range[1]) continue;
          ctx.fillStyle = "#dce2e9";
          ctx.fillRect(X(a), T, X(b) - X(a), ph);
        }
        for (const layer of series) {
          const points2 = layer.points, [lo, hi] = visibleIndices(points2, range);
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          let previous = null, gapIndex = 0;
          while (gapIndex < meta.gaps.length && meta.gaps[gapIndex][1] < range[0]) gapIndex++;
          for (let i = lo; i < hi; i++) {
            const p = points2[i];
            if (p[1] === null) {
              previous = null;
              continue;
            }
            let crossed = false;
            while (gapIndex < meta.gaps.length && meta.gaps[gapIndex][1] <= p[0]) {
              if (previous && meta.gaps[gapIndex][0] >= previous[0]) crossed = true;
              gapIndex++;
            }
            if (!previous || crossed) ctx.moveTo(X(p[0]), Y(p[1]));
            else ctx.lineTo(X(p[0]), Y(p[1]));
            previous = p;
          }
          ctx.stroke();
        }
        ctx.restore();
        if (!count && !compact) {
          ctx.fillStyle = "#758598";
          ctx.fillText(drag ? "\u6B64\u533A\u57DF\u5C1A\u672A\u7F13\u5B58\uFF0C\u677E\u5F00\u540E\u52A0\u8F7D" : "\u6B64\u533A\u95F4\u6CA1\u6709\u8BB0\u5F55", L + 20, T + 30);
        }
        return { L, pw, w, h, X };
      }
      function makePlots() {
        reconcileGroups();
        const host = $("plots"), key = JSON.stringify(groups);
        if (host.dataset.layout === key) return;
        host.dataset.layout = key;
        host.replaceChildren();
        groups.forEach((group) => {
          const section = document2.createElement("section");
          section.dataset.name = group[0];
          section.className = "wave-panel" + (group.length > 1 ? " merged" : "");
          const title = document2.createElement("div");
          title.className = "title group-title";
          const legend = document2.createElement("div");
          legend.className = "legend";
          const targets = groups.filter((g) => g !== group);
          const controls = document2.createElement("details");
          controls.className = "group-controls";
          const menuLabel = document2.createElement("summary");
          menuLabel.textContent = "\u7BA1\u7406\u901A\u9053";
          controls.append(menuLabel);
          const settings = document2.createElement("div");
          settings.className = "group-channel-settings";
          controls.append(settings);
          group.forEach((name) => {
            const label = channelLabel(name) + (displayMode === "engineering" && meta.engineering_pressure_compensated && ["\u6C14\u538B1", "\u6C14\u538B2"].includes(name) ? "\uFF08\u5DF2\u51CF\u6C14\u538B3\uFF09" : "");
            const handle = document2.createElement("span");
            handle.className = "channel-chip channel-handle";
            handle.draggable = true;
            handle.textContent = displayText(name);
            handle.style.setProperty("--channel-color", channelColor(name));
            handle.title = label + " \xB7 \u62D6\u5230\u53E6\u4E00\u5F20\u56FE\u53EF\u53E0\u52A0";
            handle.setAttribute("aria-label", label);
            handle.ondragstart = (e) => {
              movingChannel = name;
              e.dataTransfer.setData("text/plain", name);
              e.dataTransfer.effectAllowed = "move";
              document2.body.classList.add("channel-dragging");
            };
            handle.ondragend = () => {
              movingChannel = null;
              document2.body.classList.remove("channel-dragging");
              document2.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
            };
            legend.append(handle);
            if (!targets.length && group.length === 1) return;
            const row = document2.createElement("div");
            row.className = "group-channel-row";
            const caption = document2.createElement("span");
            caption.textContent = label;
            row.append(caption);
            if (targets.length) {
              const select = document2.createElement("select");
              select.setAttribute("aria-label", displayText(name) + "\u53E0\u52A0\u5230");
              const hint = document2.createElement("option");
              hint.value = "";
              hint.textContent = "\u53E0\u52A0\u5230\u2026";
              select.append(hint);
              targets.forEach((g) => {
                const option = document2.createElement("option");
                option.value = g[0];
                option.textContent = displayText(g.join(" + "));
                select.append(option);
              });
              select.onchange = () => {
                if (select.value) moveChannel(name, select.value);
              };
              row.append(select);
            }
            if (group.length > 1) {
              const split = document2.createElement("button");
              split.type = "button";
              split.textContent = "\u62C6\u51FA";
              split.setAttribute("aria-label", "\u62C6\u51FA" + displayText(name));
              split.onclick = () => moveChannel(name, null);
              row.append(split);
            }
            settings.append(row);
          });
          const axis = document2.createElement("span");
          axis.className = "axis-note";
          const units = [...new Set(group.map((n) => meta.channel_units?.[n] || "\u672A\u786E\u8BA4"))];
          axis.textContent = (group.length > 1 ? "\u5171\u7528\u7EB5\u8F74 \xB7 " : "") + units.join(" / ");
          axis.title = displayMode === "engineering" ? "\u65E7\u811A\u672C\u5904\u7406\u503C" : "\u539F\u59CB\u503C";
          title.append(legend, axis);
          if (targets.length || group.length > 1) title.append(controls);
          const value = document2.createElement("div");
          value.className = "value group-value";
          value.dataset.active = "false";
          for (const name of group) {
            const slot = document2.createElement("span"), text = document2.createElement("span");
            slot.className = "readout-item";
            slot.style.color = channelColor(name);
            slot.title = channelLabel(name);
            text.className = "readout-text";
            slot.append(text);
            value.append(slot);
          }
          const wrap = document2.createElement("div");
          wrap.className = "wave-wrap";
          const canvas = document2.createElement("canvas"), overlay = document2.createElement("canvas");
          overlay.className = "cursor-layer";
          wrap.append(canvas, overlay);
          section.append(title, value, wrap);
          host.append(section);
          events(overlay);
          section.ondragover = (e) => {
            if (movingChannel && !group.includes(movingChannel)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              section.classList.add("drop-target");
            }
          };
          section.ondragleave = (e) => {
            if (!section.contains(e.relatedTarget)) section.classList.remove("drop-target");
          };
          section.ondrop = (e) => {
            e.preventDefault();
            section.classList.remove("drop-target");
            if (!movingChannel) return;
            const name = movingChannel;
            movingChannel = null;
            document2.body.classList.remove("channel-dragging");
            moveChannel(name, group[0]);
          };
        });
      }
      function render() {
        if (!meta || document2.hidden) return;
        makePlots();
        [...$("plots").children].forEach((section, i) => {
          const layers = groups[i].map((name) => ({ name, points: data[name] || [], color: channelColor(name) }));
          paint(section.querySelector("canvas"), [], view, "", false, layers);
        });
        drawCursors();
      }
      function drawCursors() {
        [...$("plots").children].forEach((section, i) => {
          const c = section.querySelector(".cursor-layer"), [ctx, w, h] = fit(c), el = section.querySelector(".value");
          drawEventBands(ctx, w, h, view, groups[i], i === 0);
          el.dataset.active = String(hover !== null && !drag);
          if (hover === null || drag) return;
          ctx.strokeStyle = "#8095a8";
          ctx.setLineDash([3, 3]);
          const x = 68 + (hover - view[0]) / (view[1] - view[0]) * (w - 84);
          ctx.beginPath();
          ctx.moveTo(x, 12);
          ctx.lineTo(x, h - 28);
          ctx.stroke();
          for (const [j, name] of groups[i].entries()) {
            const slot = el.children[j], text = slot?.firstElementChild;
            if (!text) continue;
            const pts = data[name] || [];
            let index = lowerBound(pts, hover);
            if (index >= pts.length) index = pts.length - 1;
            if (index > 0 && Math.abs(pts[index - 1][0] - hover) < Math.abs(pts[index][0] - hover)) index--;
            const p = pts[index];
            if (p && p[0] >= view[0] && p[0] <= view[1]) {
              const suffix = " " + (p[1] ?? "\u7F3A\u5931") + " \xB7 " + clock(p[0]) + " \xB7 #" + (p[2] + 1).toLocaleString(), unit = meta.channel_units?.[name];
              text.textContent = displayText(name) + (unit ? " [" + unit + "]" : "") + suffix;
              slot.title = channelLabel(name) + suffix;
            } else {
              text.textContent = displayText(name) + " \u2014";
              slot.title = channelLabel(name) + "\uFF1A\u5F53\u524D\u8303\u56F4\u65E0\u663E\u793A\u70B9";
            }
          }
        });
      }
      let cursorRAF = 0;
      function scheduleCursor() {
        if (!cursorRAF) cursorRAF = requestAnimationFrame(() => {
          cursorRAF = 0;
          drawCursors();
        });
      }
      function pointer(c, e, range = view) {
        const r = c.getBoundingClientRect(), fraction = Math.max(0, Math.min(1, (e.clientX - r.left - 68) / (r.width - 84)));
        return range[0] + fraction * (range[1] - range[0]);
      }
      function finishDrag() {
        if (!drag) return;
        drag = null;
        scheduleRender();
        clearTimeout(timer);
        loadWave();
      }
      function events(c) {
        c.addEventListener("wheel", (e) => {
          e.preventDefault();
          if (!meta) return;
          if (e.ctrlKey) {
            const t = pointer(c, e), factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
            setView(t - (t - view[0]) * factor, t + (view[1] - t) * factor);
          } else {
            const shift = (e.deltaY + e.deltaX) / 600 * (view[1] - view[0]);
            setView(view[0] + shift, view[1] + shift);
          }
        }, { passive: false });
        c.oncontextmenu = (e) => e.preventDefault();
        c.onpointerdown = (e) => {
          if (e.button !== 0 && e.button !== 2) return;
          clearTimeout(timer);
          controller?.abort();
          serial++;
          drag = { x: e.clientX, range: [...view], limits: /* @__PURE__ */ new Map() };
          hover = null;
          render();
          c.setPointerCapture(e.pointerId);
        };
        c.onpointermove = (e) => {
          if (drag) {
            const shift = (drag.x - e.clientX) / (c.clientWidth - 84) * (drag.range[1] - drag.range[0]);
            setView(drag.range[0] + shift, drag.range[1] + shift);
          } else {
            hover = pointer(c, e);
            scheduleCursor();
          }
        };
        c.onpointerup = finishDrag;
        c.onpointercancel = c.onlostpointercapture = finishDrag;
        c.onpointerleave = () => {
          if (!drag) {
            hover = null;
            scheduleCursor();
          }
        };
        c.ondblclick = () => setView(0, Math.max(meta.duration, 1));
      }
      function drawOverview() {
        if (!meta || document2.hidden || !$("overview").clientWidth) return;
        const c = $("overview");
        if (!overviewImage || overviewImage.width !== Math.round(c.clientWidth * (devicePixelRatio || 1)) || overviewImage.height !== Math.round(c.clientHeight * (devicePixelRatio || 1))) {
          paint(c, overview, [0, Math.max(1, meta.duration)], "#547b98", true);
          overviewImage = document2.createElement("canvas");
          overviewImage.width = c.width;
          overviewImage.height = c.height;
          overviewImage.getContext("2d").drawImage(c, 0, 0);
        }
        const [ctx, w, h] = fit(c);
        ctx.drawImage(overviewImage, 0, 0, w, h);
        const X = (t) => 12 + t / Math.max(1, meta.duration) * (w - 28), a = X(view[0]), b = X(view[1]);
        ctx.fillStyle = "#167c8928";
        ctx.fillRect(a, 0, b - a, h);
        ctx.strokeStyle = "#167c89";
        ctx.strokeRect(a, 1, Math.max(2, b - a), h - 2);
        drawExternalEvents(ctx, X, [0, meta.duration], 2, h - 18, false);
      }
      function showModeInfo() {
        meta.duration = displayMode === "engineering" ? meta.display_duration : meta.raw_duration;
        meta.gaps = displayMode === "engineering" ? meta.engineering_gaps : meta.raw_gaps;
        document2.body.dataset.mode = displayMode;
        $("display-mode").value = displayMode;
        $("mode-note").textContent = displayMode === "engineering" ? "\u65E7\u811A\u672C\u663E\u793A\u6A21\u5F0F\uFF1A" + (meta.engineering_pressure_compensated ? "\u6C14\u538B1\u3001\u6C14\u538B2\u5747\u5DF2\u51CF\u53BB\u6C14\u538B3\uFF1B" : "\u5F53\u524D\u6587\u4EF6\u65E0\u53EF\u7528\u7684\u6C14\u538B1/2/3\u8865\u507F\u7EC4\u5408\uFF1B") + "\u91CD\u590D\u65F6\u95F4\u6233\u6309\u65E7\u811A\u672C\u7B97\u6CD5\u4F30\u7B97\u5C55\u5F00\uFF0C\u4EC5\u7528\u4E8E\u663E\u793A\uFF0C\u4E0D\u4EE3\u8868\u5DF2\u786E\u8BA4\u7684\u91C7\u6837\u65F6\u95F4\u3002\u65AD\u7EBF\u9608\u503C " + meta.engineering_gap_threshold + " \u79D2\uFF08\u6CBF\u7528\u65E7\u811A\u672C\uFF09\uFF1B\u7B2C14\u5217 " + (meta.engineering_byte_column || "\u672A\u5E94\u7528\u5B57\u8282\u8F6C\u6362") + " \u6CBF\u7528\u5927\u4E8E125\u51CF256\u89C4\u5219\u3002" : "\u539F\u59CB\u6A21\u5F0F\uFF1A\u4FDD\u7559\u539F\u59CB\u538B\u529B\u548C\u79D2\u7EA7\u65F6\u95F4\u6233\uFF0C\u540C\u4E00\u79D2\u5185\u53EF\u80FD\u5448\u7AD6\u7EBF\u3002\u76F8\u90BB\u65F6\u95F4\u5DEE\u8D85\u8FC71\u79D2\u663E\u793A\u7070\u8272\u95F4\u9694\uFF0C\u4E0D\u8F6C\u6362\u6570\u503C\u5355\u4F4D\u3002";
        if (meta.channel_units && Object.keys(meta.channel_units).length) $("mode-note").textContent += " \u538B\u529B\u5355\u4F4DPa\uFF1A\u6C14\u538B1\u4E3A\u5185\u90E8\u3001\u6C14\u538B2\u4E3A\u51FA\u98CE\u53E3\u3001\u6C14\u538B3\u4E3A\u6807\u51C6\u6C14\u538B\uFF1B\u4EC5\u6C14\u538B1/2\u6309\u73B0\u6709\u89C4\u5219\u6263\u9664\u6C14\u538B3\uFF1B\u673A\u5668\u603B\u6D41\u91CF\u3001\u77AC\u65F6\u603B\u6F0F\u6C14\u7387\u5747\u4E3AL/min\uFF0C\u4E0D\u76F8\u51CF\u3002";
        if (meta.sampling_info) $("mode-note").textContent += " CSV\u6BCF\u4E2A\u6709\u8BB0\u5F55\u6574\u79D2\u7684\u884C\u6570\u4E2D\u4F4D\u503C " + meta.median_records_per_second + "\uFF08P10\u2013P90\uFF1A" + meta.sampling_info.record_count_p10 + "\u2013" + meta.sampling_info.record_count_p90 + "\uFF09\uFF0C\u4E0D\u4EE3\u8868\u72EC\u7ACB\u91C7\u6837\u7387\u3002\u8BBE\u5907\u53CD\u9988\u538B\u529B\u7EA647\u201348Hz\u3001\u9884\u671F50Hz\uFF1B\u8BA1\u7B97\u6D41\u91CF/\u6F0F\u6C14\u7EA630Hz\u5F85\u6838\u5B9E\uFF0C\u4E0D\u636E\u6B64\u5F3A\u5236\u91CD\u91C7\u6837\u3002";
        $("info").replaceChildren();
        [meta.name, meta.rows.toLocaleString() + " \u884C", meta.start + " \u2014 " + meta.end, "\u5F53\u524D\u6A21\u5F0F\u65AD\u7EBF " + meta.gaps.length + " \u5904"].forEach((s) => {
          const span = document2.createElement("span");
          span.textContent = s;
          $("info").append(span);
        });
      }
      async function loadOverview() {
        const gen = generation, channel = meta.channels.includes("\u6D41\u91CF") ? "\u6D41\u91CF" : selected[0] || meta.channels[0], q = new URLSearchParams({ start: 0, end: Math.max(meta.duration, 1), pixels: 1e3, channel, mode: displayMode });
        try {
          const d = await api("/api/wave?" + q);
          if (gen !== generation) return;
          overview = d.series[channel] || [];
          overviewImage = null;
          drawOverview();
        } catch (e) {
          if (gen === generation) error(e);
        }
      }
      function changeMode(mode) {
        if (!meta) return;
        displayMode = mode;
        generation++;
        serial++;
        controller?.abort();
        cache = null;
        data = {};
        overview = [];
        overviewImage = null;
        hover = null;
        drag = null;
        $("plots").dataset.layout = "";
        showModeInfo();
        setView(...view, 0);
        loadOverview();
        renderEventList();
      }
      async function init(m) {
        $("show-all-channels").checked = true;
        generation++;
        const gen = generation;
        serial++;
        controller?.abort();
        clearTimeout(timer);
        meta = m;
        displayMode = "engineering";
        cache = null;
        data = {};
        overviewImage = null;
        hover = null;
        drag = null;
        groups = [];
        const parts = m.start.slice(11, 19).split(":").map(Number);
        baseSecond = parts[0] * 3600 + parts[1] * 60 + parts[2];
        $("error").textContent = "";
        if (duplicateScanResolve) finishDuplicateScan("cancel");
        if ($("scan-history-dialog").open) $("scan-history-dialog").close();
        historySerial++;
        $("feedback-run").replaceChildren();
        $("scan-result").replaceChildren();
        annotations = null;
        restoreExternalEvents();
        try {
          if (!m.file_id) throw Error("\u8BF7\u91CD\u542F\u67E5\u770B\u5668\u540E\u518D\u4F7F\u7528\u4E8B\u4EF6\u7B5B\u67E5");
          const storage = usesSessionEvents(m) ? transientAnnotationStorage : localStorage;
          annotations = new AnnotationModel(m, storage);
          annotations.load();
        } catch (e) {
          annotations = null;
          error(e);
        }
        renderEventList();
        $("info").replaceChildren();
        [m.name, m.rows.toLocaleString() + " \u884C", m.start + " \u2014 " + m.end, "\u65F6\u95F4\u95F4\u9694\u5F02\u5E38 " + m.gaps.length + " \u5904"].forEach((s) => {
          const span = document2.createElement("span");
          span.textContent = s;
          $("info").append(span);
        });
        groups = defaultPlotGroups.map((group) => group.filter((n) => m.channels.includes(n))).filter((group) => group.length);
        if (!groups.length) groups = m.channels.slice(0, 3).map((name) => [name]);
        selected = groups.flat();
        $("channels").replaceChildren();
        m.channels.filter((name) => !analysisDerivedNames.includes(name)).forEach((name) => {
          const l = document2.createElement("label"), c = document2.createElement("input");
          c.type = "checkbox";
          c.checked = selected.includes(name);
          c.dataset.name = name;
          c.onchange = channelSelectionChanged;
          l.append(c, document2.createTextNode(" " + channelLabel(name)));
          $("channels").append(l);
        });
        filterChannels();
        const previousBatch = usesSessionEvents(m) ? scanViews.get(m.file_id) : null;
        if (!primaryProfiles.includes($("scan-profile").value)) {
          selectDetectionProfile("dynamic_baseline_v3");
          $("scan-profile").onchange();
        }
        $("time").value = m.start.slice(11, 19);
        overview = [];
        $("plots").dataset.layout = "";
        showModeInfo();
        setView(0, Math.max(m.duration, 1), 0);
        loadOverview();
        eventSyncReady = false;
        serverRevision = 0;
        const eventsReady = refreshSharedEvents(true);
        const runsReady = loadFeedbackRuns(previousBatch?.runId);
        $("device-metrics").replaceChildren();
        loadDeviceMetrics();
        renderDetectionChoices();
        renderDisplayChoices();
        resizeSidebar();
        restoreFileView();
        if (!fileSwitching) {
          let entry = fileLibrary.find((f) => f.file_id === m.file_id);
          if (!entry) {
            entry = { id: ++librarySerial, name: m.name, file_id: m.file_id, file: null };
            fileLibrary.push(entry);
          }
          activeLibraryId = entry.id;
          renderFileLibrary();
        }
        if (previousBatch) {
          await Promise.all([eventsReady, runsReady]);
          if (meta !== m) return;
          try {
            await showScanBatch(previousBatch.runId, true);
          } catch (e) {
            if (meta === m) error(e);
          }
        }
      }
      $("file").onchange = async (e) => {
        const input = e.target, files = [...input.files];
        if (!files.length) return;
        if (fileSwitching || scanning || eventSaving) {
          error("\u8BF7\u7B49\u5F85\u626B\u63CF\u3001\u4FDD\u5B58\u6216\u6587\u4EF6\u5207\u6362\u5B8C\u6210\u540E\u518D\u6DFB\u52A0");
          e.target.value = "";
          return;
        }
        const added = [];
        for (const file of files) {
          let entry = fileLibrary.find((f) => f.file && f.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified);
          if (!entry) {
            entry = { id: ++librarySerial, name: file.name, file, file_id: null };
            fileLibrary.push(entry);
          } else entry.file = file;
          added.push(entry);
        }
        renderFileLibrary();
        try {
          await switchLibraryFile(added[0].id);
        } finally {
          input.value = "";
        }
      };
      function rememberFileView() {
        if (!meta) return;
        try {
          localStorage.setItem("respiratory-view-v1:" + meta.file_id, JSON.stringify({ view, selected, groups, displayMode, channelScopeVersion: 2, channelListVersion: 1, showAllChannels: $("show-all-channels").checked, window: $("window").value, time: $("time").value }));
        } catch (e) {
        }
      }
      function restoreFileView() {
        if (!meta) return;
        try {
          const saved = JSON.parse(localStorage.getItem("respiratory-view-v1:" + meta.file_id) || "null");
          if (!saved || !Array.isArray(saved.view) || saved.view.length !== 2 || !saved.view.every(Number.isFinite) || saved.view[1] <= saved.view[0]) return;
          $("show-all-channels").checked = saved.channelListVersion !== 1 || saved.showAllChannels !== false;
          const fallback = [...selected];
          if (saved.channelScopeVersion === 2 && Array.isArray(saved.selected)) selected = saved.selected.filter((n) => meta.channels.includes(n));
          selected = selected.filter((n) => !analysisDerivedNames.includes(n));
          if (saved.selected?.length && !selected.length) selected = fallback;
          if (saved.channelScopeVersion === 2 && Array.isArray(saved.groups)) groups = saved.groups.filter(Array.isArray);
          reconcileGroups();
          displayMode = ["raw", "engineering"].includes(saved.displayMode) ? saved.displayMode : displayMode;
          showModeInfo();
          $("channels").querySelectorAll("input").forEach((c) => c.checked = selected.includes(c.dataset.name));
          filterChannels();
          if (saved.window) $("window").value = saved.window;
          if (saved.time) $("time").value = saved.time;
          generation++;
          serial++;
          controller?.abort();
          cache = null;
          data = {};
          overviewImage = null;
          $("plots").dataset.layout = "";
          setView(...saved.view, 0);
          loadOverview();
        } catch (e) {
        }
      }
      function renderFileLibrary() {
        const host = $("file-list");
        host.replaceChildren();
        const query = $("file-search").value.trim().toLowerCase();
        for (const entry of fileLibrary) {
          if (!entry.name.toLowerCase().includes(query)) continue;
          const row = document2.createElement("div");
          row.className = "library-row";
          const button = document2.createElement("button");
          button.type = "button";
          button.className = "library-file";
          button.textContent = (entry.id === activeLibraryId ? "\u25CF " : "") + entry.name + (entry.error ? " \xB7 \u6253\u5F00\u5931\u8D25" : "");
          button.title = entry.name + (entry.file_id ? "\n\u5185\u5BB9\u6307\u7EB9\uFF1A" + entry.file_id : "\n\u70B9\u51FB\u65F6\u8BFB\u53D6");
          button.disabled = fileSwitching;
          button.setAttribute("aria-pressed", String(entry.id === activeLibraryId));
          button.onclick = () => switchLibraryFile(entry.id);
          const close = document2.createElement("button");
          close.type = "button";
          close.className = "library-close";
          close.textContent = "\xD7";
          close.title = "\u5173\u95ED\u6587\u4EF6";
          close.setAttribute("aria-label", "\u5173\u95ED\u6587\u4EF6 " + entry.name);
          close.disabled = fileSwitching;
          close.onclick = () => closeLibraryFile(entry.id);
          row.append(button, close);
          host.append(row);
        }
        $("file-library-count").textContent = fileLibrary.length + " \u4EFD";
      }
      async function closeLibraryFile(id) {
        if (fileSwitching) return;
        if (scanning || eventSaving) return error("\u8BF7\u7B49\u5F85\u7B5B\u67E5\u6216\u5BFC\u5165\u5B8C\u6210\u540E\u518D\u5173\u95ED\u6587\u4EF6");
        const entry = fileLibrary.find((f) => f.id === id);
        if (!entry) return;
        const temporary = usesSessionEvents();
        if (id === activeLibraryId) {
          const next = fileLibrary.find((f) => f.id !== id && !f.error) || fileLibrary.find((f) => f.id !== id);
          if (next) {
            await switchLibraryFile(next.id);
            if (activeLibraryId === id) return;
          } else {
            fileSwitching = true;
            renderFileLibrary();
            rememberFileView();
            try {
              await api("/api/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: meta.file_id }) });
              clearCurrentFileView();
            } catch (e) {
              error(e);
              return;
            } finally {
              fileSwitching = false;
            }
          }
        }
        if (entry.file_id) try {
          await api("/api/cache/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: entry.file_id }) });
        } catch (e) {
        }
        if (temporary) {
          scanViews.delete(entry.file_id);
          sessionExternalEvents.delete(entry.file_id);
        }
        entry.file = null;
        fileLibrary = fileLibrary.filter((f) => f.id !== id);
        renderFileLibrary();
        $("status").textContent = (meta ? "\u5DF2\u5173\u95ED " + entry.name : "\u6240\u6709\u6587\u4EF6\u5DF2\u5173\u95ED") + (temporary ? "\uFF1B\u4E34\u65F6\u7B5B\u67E5\u7ED3\u679C\u5DF2\u6E05\u9664\u3002" : "\uFF1B\u539F\u59CB CSV \u548C\u6807\u8BB0\u4FDD\u7559\u3002");
      }
      function clearCurrentFileView() {
        generation++;
        serial++;
        feedbackSerial++;
        historySerial++;
        controller?.abort();
        clearTimeout(timer);
        meta = null;
        restoreExternalEvents();
        annotations = null;
        activeLibraryId = null;
        eventSyncReady = false;
        serverRevision = 0;
        selected = [];
        groups = [];
        data = {};
        overview = [];
        cache = null;
        overviewImage = null;
        hover = null;
        drag = null;
        for (const id of ["plots", "channels", "feedback-run", "device-metrics", "scan-result"]) $(id).replaceChildren();
        $("plots").dataset.layout = "";
        $("info").textContent = "\u5C1A\u672A\u52A0\u8F7D\u6587\u4EF6\uFF0C\u8BF7\u6DFB\u52A0CSV";
        $("mode-note").textContent = "\u8BF7\u9009\u62E9\u4E00\u4EFD\u6216\u591A\u4EFDCSV";
        $("channel-count").textContent = "\u5DF2\u9009 0 / 0";
        $("range").textContent = "";
        $("error").textContent = "";
        if ($("scan-history-dialog").open) $("scan-history-dialog").close();
        const canvas = $("overview");
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        renderEventList();
      }
      async function switchLibraryFile(id) {
        const entry = fileLibrary.find((f) => f.id === id);
        if (!entry || fileSwitching) return;
        if (scanning || eventSaving) return error("\u8BF7\u7B49\u5F85\u7B5B\u67E5\u6216\u5BFC\u5165\u5B8C\u6210\u540E\u518D\u5207\u6362\u6587\u4EF6");
        if (id === activeLibraryId && entry.file_id === meta?.file_id) return;
        fileSwitching = true;
        renderFileLibrary();
        rememberFileView();
        $("status").textContent = "\u6B63\u5728\u8BFB\u53D6 " + entry.name + " \u2026";
        try {
          const active = fileLibrary.find((f) => f.id === activeLibraryId);
          if (active && !active.file && meta?.file_id === active.file_id) {
            const response = await fetch2("/api/current-csv?file_id=" + encodeURIComponent(active.file_id));
            if (!response.ok) throw Error("\u539F\u6587\u4EF6\u5DF2\u5207\u6362\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u9009\u62E9");
            active.file = new File([await response.blob()], active.name, { type: "text/csv" });
          }
          serial++;
          controller?.abort();
          clearTimeout(timer);
          let m, cacheHit = false;
          if (entry.file_id) {
            const cached = await api("/api/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: entry.file_id }) });
            if (cached.hit) {
              m = cached.meta;
              cacheHit = true;
            }
          }
          if (!m) {
            if (!entry.file) throw Error("\u6B64\u6587\u4EF6\u4E0D\u5728\u7F13\u5B58\u4E2D\uFF0C\u8BF7\u7528\u201C\u6DFB\u52A0CSV\u201D\u91CD\u65B0\u9009\u62E9");
            $("status").textContent = "\u9996\u6B21\u8BFB\u53D6\u6216\u7F13\u5B58\u5DF2\u91CA\u653E\uFF0C\u6B63\u5728\u89E3\u6790 " + entry.name + " \u2026";
            m = await api("/api/open", { method: "POST", headers: { "X-Filename": encodeURIComponent(entry.file.name) }, body: entry.file });
          }
          const duplicate = fileLibrary.find((f) => f.id !== entry.id && f.file_id === m.file_id);
          if (duplicate) {
            duplicate.file = entry.file;
            duplicate.name = entry.name;
            fileLibrary = fileLibrary.filter((f) => f.id !== entry.id);
            activeLibraryId = duplicate.id;
          } else {
            entry.file_id = m.file_id;
            entry.error = null;
            activeLibraryId = entry.id;
          }
          await init(m);
          const restored = usesSessionEvents(m) ? scanViews.has(m.file_id) ? "\uFF0C\u5DF2\u6062\u590D\u672C\u6B21\u7B5B\u67E5\u7ED3\u679C\u3002" : "\u3002\u53EF\u624B\u52A8\u5F00\u59CB\u7B5B\u67E5\u3002" : "\uFF0C\u5DF2\u6062\u590D\u8BE5\u6587\u4EF6\u7684\u6807\u8BB0\u4E0E\u67E5\u770B\u8BBE\u7F6E\u3002";
          $("status").textContent = (cacheHit ? "\u5DF2\u4ECE\u7F13\u5B58\u5FEB\u901F\u5207\u6362\u5230 " : "\u5DF2\u8BFB\u53D6 ") + m.name + restored;
        } catch (e) {
          entry.error = e.message;
          error(e);
          $("status").textContent = "\u6587\u4EF6\u5207\u6362\u5931\u8D25\uFF0C\u539F\u6709\u6807\u8BB0\u672A\u5220\u9664";
          if (meta) loadWave(true);
        } finally {
          fileSwitching = false;
          renderFileLibrary();
        }
      }
      $("file-search").oninput = renderFileLibrary;
      window2.addEventListener("beforeunload", rememberFileView);
      $("all").onclick = () => meta && setView(0, Math.max(meta.duration, 1));
      $("channel-search").oninput = filterChannels;
      $("selected-only").onchange = filterChannels;
      $("show-all-channels").onchange = filterChannels;
      $("select-visible").onclick = () => {
        if (!meta) return;
        for (const label of $("channels").children) if (!label.hidden) label.querySelector("input").checked = true;
        channelSelectionChanged();
      };
      $("clear-channels").onclick = () => {
        if (!meta) return;
        $("channels").querySelectorAll("input").forEach((c) => c.checked = false);
        channelSelectionChanged();
      };
      $("display-mode").onchange = (e) => changeMode(e.target.value);
      $("reference-view").onclick = () => {
        if (!meta) return;
        selected = ["\u6C14\u538B1", "\u6C14\u538B2", "\u6C14\u538B1\u2212\u6C14\u538B2\uFF08\u5DEE\u538B\uFF09", "\u63A7\u5236\u538B\u529B"].filter((n) => meta.channels.includes(n));
        if (!selected.length) {
          error("\u5F53\u524D\u6587\u4EF6\u6CA1\u6709\u8FD9\u4E9B\u538B\u529B\u901A\u9053");
          return;
        }
        groups = [[...selected]];
        $("channels").querySelectorAll("input").forEach((c) => c.checked = selected.includes(c.dataset.name));
        filterChannels();
        $("window").value = 5;
        changeMode("engineering");
        $("go").click();
      };
      $("merge-all").onclick = () => {
        if (!selected.length) return;
        groups = [[...selected]];
        hover = null;
        render();
      };
      $("split-all").onclick = () => {
        groups = selected.map((n) => [n]);
        hover = null;
        render();
      };
      $("in").onclick = () => {
        const c = (view[0] + view[1]) / 2, w = (view[1] - view[0]) / 4;
        setView(c - w, c + w);
      };
      $("out").onclick = () => {
        const c = (view[0] + view[1]) / 2, w = view[1] - view[0];
        setView(c - w, c + w);
      };
      for (const [id, dir] of [["prev", -1], ["next", 1]]) $(id).onclick = () => {
        const d = (view[1] - view[0]) * 0.8 * dir;
        setView(view[0] + d, view[1] + d);
      };
      $("go").onclick = () => {
        if (!meta) return;
        const width = Number($("window").value);
        if (!Number.isFinite(width) || width < 1) return error("\u7A97\u53E3\u957F\u5EA6\u5E94\u4E3A\u81F3\u5C11 1 \u79D2");
        const base = new Date(meta.start.replace(" ", "T")), parts = $("time").value.split(":").map(Number);
        if (parts.length < 2) return error("\u8BF7\u8F93\u5165\u5B9A\u4F4D\u65F6\u95F4");
        const target = new Date(base);
        target.setHours(parts[0], parts[1], parts[2] || 0, 0);
        if (target < base) target.setDate(target.getDate() + 1);
        const t = (target - base) / 1e3;
        setView(t - width / 2, t + width / 2);
      };
      function overviewTime(e) {
        const r = $("overview").getBoundingClientRect();
        return Math.max(0, Math.min(meta.duration, (e.clientX - r.left - 12) / (r.width - 28) * meta.duration));
      }
      $("overview").onpointerdown = (e) => {
        if (!meta) return;
        overviewDrag = overviewTime(e);
        $("overview").setPointerCapture(e.pointerId);
      };
      $("overview").onpointerup = (e) => {
        if (overviewDrag === null) return;
        const t = overviewTime(e), a = overviewDrag;
        overviewDrag = null;
        if (Math.abs(t - a) < 1) {
          const w = view[1] - view[0];
          setView(t - w / 2, t + w / 2);
        } else setView(Math.min(a, t), Math.max(a, t));
      };
      $("overview").onpointercancel = () => overviewDrag = null;
      window2.addEventListener("keydown", (e) => {
        if (!meta || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          $(e.key === "ArrowLeft" ? "prev" : "next").click();
        } else if (e.key === "Home" || e.key.toLowerCase() === "r") {
          $("all").click();
        }
      });
      window2.addEventListener("resize", () => {
        if (embeddedAnalysis && !embeddedAnalysisVisible) return;
        overviewImage = null;
        scheduleRender();
        clearTimeout(timer);
        timer = setTimeout(() => loadWave(true), 150);
      });
      function eventClock(t) {
        const d = new Date(Date.parse(meta.start.replace(" ", "T")) + Math.round(t * 1e3));
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + " " + [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":") + "." + String(d.getMilliseconds()).padStart(3, "0");
      }
      const externalKey = (id) => "respiratory-external-events-v1:" + id;
      let externalEvents = [];
      const sessionExternalEvents = /* @__PURE__ */ new Map();
      function externalTime(value) {
        if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)) return NaN;
        const t = Date.parse(value.replace(" ", "T") + "Z");
        return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === value.replace(" ", "T").slice(0, 19) ? t : NaN;
      }
      function parseExternalEvents(packet, recording) {
        const rows = packet?.data?.records, origin = externalTime(recording.start);
        if (!Array.isArray(rows) || !Number.isFinite(origin)) throw Error("\u9700\u8981\u5305\u542B data.records \u7684\u8BBE\u5907\u4E8B\u4EF6 JSON\uFF0C\u4EE5\u53CA\u6709\u6548\u7684 CSV \u8D77\u59CB\u65F6\u95F4\u3002");
        const events2 = /* @__PURE__ */ new Map();
        let outside = 0, unresolved = 0;
        for (const row of rows) {
          if (!row || Number(row.dataType) !== 2) continue;
          for (const [key, label] of [["apnea", "\u547C\u5438\u6682\u505C"], ["ca", "\u4E2D\u67A2\u6027\u6682\u505C"], ["hypopnea", "\u4F4E\u901A\u6C14"]]) {
            const count = Number(row[key + "Count"]);
            if (!(count > 0)) continue;
            const duration = Number(row[key + "Duration"]), end = (externalTime(row.dateDate) - origin) / 1e3;
            if (count !== 1 || !Number.isFinite(end) || !(duration > 0 && Number.isFinite(duration))) {
              unresolved++;
              continue;
            }
            const start = end - duration;
            if (end <= 0 || start >= recording.raw_duration) {
              outside++;
              continue;
            }
            const keyId = JSON.stringify([label, end, duration]);
            events2.set(keyId, { label, start, end, duration, stamp: row.dateDate });
          }
        }
        return { events: [...events2.values()].sort((a, b) => a.start - b.start), outside, unresolved };
      }
      function renderExternalEvents(message = "") {
        const list = $("external-jump");
        const option = (label, value) => {
          const o = document2.createElement("option");
          o.textContent = label;
          o.value = value;
          return o;
        };
        list.replaceChildren(option("\u8DF3\u8F6C\u5230\u5916\u90E8\u4E8B\u4EF6", ""));
        externalEvents.forEach((e, i) => list.append(option(eventClock(e.start) + " \u2014 " + eventClock(e.end) + " \xB7 " + e.label + " \xB7 " + e.duration + " \u79D2", String(i))));
        list.hidden = $("external-clear").hidden = !externalEvents.length;
        $("external-status").textContent = message || (externalEvents.length ? "\u5916\u90E8\u4E8B\u4EF6 " + externalEvents.length + " \u6761 \xB7 \u7D2B\u8272\u533A\u95F4\uFF0C\u865A\u7EBF\u4E3A\u8BBE\u5907\u62A5\u544A\u7EC8\u70B9" : "\u5916\u90E8\u4E8B\u4EF6\u72EC\u7ACB\u4E8E\u81EA\u52A8\u68C0\u6D4B");
      }
      function restoreExternalEvents() {
        externalEvents = [];
        if (usesSessionEvents()) externalEvents = sessionExternalEvents.get(meta.file_id) || [];
        else if (meta) try {
          const saved = JSON.parse(localStorage.getItem(externalKey(meta.file_id)) || "[]");
          if (Array.isArray(saved)) externalEvents = saved.filter((e) => e && Number.isFinite(e.duration) && e.duration > 0).map((e) => {
            const end = e.end ?? e.start;
            return { ...e, end, start: end - e.duration };
          }).filter((e) => Number.isFinite(e.end) && e.end > 0 && e.start < meta.raw_duration).sort((a, b) => a.start - b.start);
        } catch (e) {
        }
        renderExternalEvents();
      }
      $("external-file").onchange = async (e) => {
        const file = e.target.files?.[0], recording = meta;
        e.target.value = "";
        if (!file) return;
        if (!recording) return renderExternalEvents("\u8BF7\u5148\u6253\u5F00\u5BF9\u5E94\u7684 CSV\u3002");
        try {
          const packet = JSON.parse((await file.text()).replace(/^﻿/, ""));
          if (meta !== recording || fileSwitching) return;
          const { events: events2, outside, unresolved } = parseExternalEvents(packet, recording);
          const details = (outside ? "\uFF1B" + outside + " \u6761\u5728\u5F53\u524D CSV \u65F6\u95F4\u8303\u56F4\u5916" : "") + (unresolved ? "\uFF1B" + unresolved + " \u6761\u65E0\u6CD5\u5B9A\u4F4D\u4E3A\u5355\u6B21\u4E8B\u4EF6" : "");
          if (!events2.length) return renderExternalEvents("\u672A\u5BFC\u5165\u4EFB\u4F55\u4E8B\u4EF6" + details + "\u3002\u8BF7\u6838\u5BF9 CSV \u5BF9\u5E94\u7684\u5F55\u5236\u65E5\u671F\u548C\u65F6\u95F4\u3002");
          externalEvents = events2;
          let saved = true;
          if (usesSessionEvents(recording)) {
            sessionExternalEvents.set(recording.file_id, events2);
            saved = false;
          } else try {
            localStorage.setItem(externalKey(recording.file_id), JSON.stringify(events2));
          } catch (e2) {
            saved = false;
          }
          renderExternalEvents("\u5DF2\u5BFC\u5165 " + events2.length + " \u6761" + details + "\u3002\u7D2B\u8272\u533A\u95F4\u6309\u62A5\u544A\u7EC8\u70B9\u5F80\u524D\u6807\u8BB0" + (saved ? "\u3002" : "\uFF1B\u672C\u6B21\u663E\u793A\uFF0C\u5237\u65B0\u540E\u9700\u91CD\u65B0\u5BFC\u5165\u3002"));
          scheduleRender();
        } catch (err) {
          renderExternalEvents("\u5BFC\u5165\u5931\u8D25\uFF1A" + err.message);
        }
      };
      $("external-show").onchange = () => scheduleRender();
      $("external-clear").onclick = () => {
        if (!meta) return;
        if (usesSessionEvents()) sessionExternalEvents.delete(meta.file_id);
        else try {
          localStorage.removeItem(externalKey(meta.file_id));
        } catch (e) {
          return renderExternalEvents("\u65E0\u6CD5\u6E05\u9664\u672C\u673A\u4FDD\u5B58\u7684\u5916\u90E8\u4E8B\u4EF6\u3002");
        }
        externalEvents = [];
        renderExternalEvents();
        scheduleRender();
      };
      $("external-jump").onchange = (e) => {
        if (e.target.value === "") return;
        const item = externalEvents[Number(e.target.value)];
        if (item) setView(item.start - 8, item.end + 8, 0);
        e.target.value = "";
      };
      function drawExternalEvents(ctx, X, range, top, bottom, labels) {
        if (!$("external-show").checked) return;
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle = "#7c3aed";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.font = waveChartFont;
        let labelEnd = -Infinity;
        for (const e of externalEvents) {
          if (e.end <= range[0] || e.start >= range[1]) continue;
          const x = X(Math.max(e.start, range[0])), right = X(Math.min(e.end, range[1]));
          ctx.fillStyle = "#7c3aed28";
          ctx.fillRect(x, top, Math.max(1, right - x), bottom - top);
          if (e.end <= range[1]) {
            ctx.beginPath();
            ctx.moveTo(right, top);
            ctx.lineTo(right, bottom);
            ctx.stroke();
          }
          if (labels && x > labelEnd) {
            ctx.fillStyle = "#7c3aed";
            const label = "\u5916\u90E8 \xB7 " + e.label + " " + e.duration + "s";
            ctx.fillText(label, x + 3, top + 11);
            labelEnd = x + 8 + ctx.measureText(label).width;
          }
        }
        ctx.restore();
      }
      const firstPlotEvents = $("first-plot-events");
      try {
        firstPlotEvents.checked = localStorage.getItem("respiratory-first-plot-events") !== "false";
      } catch (e) {
        firstPlotEvents.checked = true;
      }
      firstPlotEvents.onchange = () => {
        try {
          localStorage.setItem("respiratory-first-plot-events", String(firstPlotEvents.checked));
        } catch (e) {
        }
        scheduleCursor();
      };
      function drawEventBands(ctx, w, h, range, channels, firstPlot = false) {
        const left = 68, right = 84, X = (t) => left + (t - range[0]) / (range[1] - range[0]) * (w - right);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, 0, w - right, h - 28);
        ctx.clip();
        const events2 = firstPlot && !firstPlotEvents.checked ? [] : visibleEvents(annotations?.items || []).filter((e) => e.end >= range[0] && e.start <= range[1] && (firstPlot || e.channels.some((c) => channels.includes(c))) && (!isBaseline(e.detection_profile) || !channels.some((c) => allDynamicNames.includes(c) || allOptimizedNames.includes(c) || allPatientNames.includes(c)) || e.detection_method === dynamicMethod() && (!channels.some((c) => allPatientNames.includes(c)) || isPatientFlow(e.detection_profile)) && (!channels.some((c) => allOptimizedNames.includes(c)) || isOptimized(e.detection_profile))));
        events2.forEach((e, i) => {
          const a = Math.max(left, X(e.start)), b = Math.min(w - 16, X(e.end)), color = eventColors[e.type];
          ctx.fillStyle = color + "28";
          ctx.fillRect(a, 12, Math.max(1, b - a), h - 40);
          ctx.strokeStyle = color;
          ctx.setLineDash([]);
          ctx.strokeRect(a, 12, Math.max(1, b - a), h - 40);
          if (b - a > 45) {
            ctx.fillStyle = color;
            ctx.font = waveChartFont;
            ctx.fillText(displayText(e.type) + " " + (e.end - e.start).toFixed(2) + "s", a + 3, 24 + i % 3 * 13);
          }
        });
        if (firstPlot) drawExternalEvents(ctx, X, range, 30, h - 29, true);
        ctx.restore();
      }
      function renderEventModeLabel() {
        const profile = $("scan-profile").value, manual = activeResultGroup === "manual";
        const labels = { patient_flow_v4: "\u60A3\u8005\u6D41\u91CF\uFF1A\u6682\u505C/\u4F4E\u901A\u6C14\uFF08\u4F18\u5316v4\uFF09", company_rules: "\u5E45\u5EA6\u89C4\u5219\uFF08\u8BD5\u9A8C\uFF09", dynamic_baseline_v3: "\u52A8\u6001\u57FA\u7EBF\u4F18\u5316\u6D4B\u8BD5\uFF08v3 \xB7 \u8D77\u70B9\u590D\u6838\uFF09" };
        $("event-mode-label").textContent = manual ? "\u4EBA\u5DE5 / Agent \u6807\u8BB0" : $("scan-profile").selectedOptions?.[0]?.textContent || labels[profile] || "\u5386\u53F2\u68C0\u6D4B\u7ED3\u679C";
        $("event-mode-config").textContent = manual ? "\u5F53\u524D\u6587\u4EF6\u7684\u4EBA\u5DE5\u4E0EAgent\u6807\u8BB0" : isBaseline(profile) ? baselineMethodLabel(baselineArgs().dynamic_method) + " \xB7 " + baselineArgs().window_seconds + "\u79D2\u7A97\u53E3 \xB7 \u6700\u77ED\u6301\u7EED" + $("scan-duration").value + "\u79D2" : profile === "company_rules" ? (amplitudeSource() === "csv_flow" ? "CSV\u6D41\u91CF" : "\u538B\u529B\u4F30\u7B97Q") + " \xB7 5\u79D2\u5E45\u5EA6\u7A97\u53E3 \xB7 \u8FDE\u7EED\u8D85\u8FC7" + $("scan-duration").value + "\u79D2" : "\u4E0E\u6240\u9009\u5386\u53F2\u626B\u63CF\u6279\u6B21\u4E00\u81F4";
        $("result-current").hidden = !manual;
      }
      function renderEventList() {
        const list = $("event-list"), previousScroll = list.scrollTop || 0;
        list.replaceChildren();
        renderEventModeLabel();
        const saved = [...annotations?.items || []], all = saved.filter((e) => e.status !== "ignored" && matchesResultGroup(e, activeResultGroup)).sort((a, b) => a.start - b.start);
        for (const [group, id, label] of [["automatic", "result-auto", "\u81EA\u52A8\u68C0\u6D4B"], ["company", "result-company", "\u5E45\u5EA6\u89C4\u5219"], ["adaptive", "result-adaptive", "\u81EA\u9002\u5E94\u6D4B\u8BD5"], ["baseline", "result-baseline", "\u52A8\u6001\u57FA\u7EBF\u4F18\u5316v3"], ["manual", "result-manual", "\u4EBA\u5DE5 / Agent"]]) {
          const button = $(id);
          button.textContent = label + (group === "company" ? " \xB7 " + (amplitudeSource() === "csv_flow" ? "CSV\u6D41\u91CF" : "\u538B\u529B\u4F30\u7B97Q") : "") + "\uFF08" + saved.filter((e) => e.status !== "ignored" && matchesResultGroup(e, group)).length + "\uFF09";
          button.ariaPressed = String(group === activeResultGroup && (group !== "baseline" || activeBaselineProfile === "dynamic_baseline_v3"));
        }
        const items = visibleEvents(all), scope = currentScanView();
        $("scan-view-note").textContent = scope ? primaryProfiles.includes(scope.profile) ? "" : "\u6B63\u5728\u67E5\u770B\u5386\u53F2\u65B9\u6848\u7684\u6279\u6B21\u3002" : "";
        $("event-count").textContent = "\u663E\u793A " + items.length + " / \u5171 " + all.length + " \u6761";
        $("event-summary").textContent = annotations ? (activeResultGroup === "baseline" && $("baseline-all-configs").checked ? "\u6240\u6709\u914D\u7F6E\u5BF9\u7167\uFF1A\u53EF\u80FD\u542B\u91CD\u53E0\u5019\u9009\uFF0C\u8BF7\u52FF\u7D2F\u8BA1\u4E3A\u72EC\u7ACB\u4E8B\u4EF6\u3002" : "") + (items.length ? "\u9009\u62E9\u7ED3\u679C\u53EF\u5B9A\u4F4D\u5230\u6CE2\u5F62\u3002" : "") : "";
        const choices = displayTypesForCurrentGroup(), checked = choices.filter((t) => visibleEventTypes.has(t)).length;
        $("display-type-summary").textContent = checked === choices.length ? "\u672C\u9875\u5168\u90E8\u7C7B\u578B" : checked ? "\u672C\u9875\u5DF2\u9009 " + checked + " \u79CD\u7C7B\u578B" : "\u672A\u9009\u62E9\u663E\u793A\u7C7B\u578B";
        if (!items.length) {
          const text = document2.createElement("p");
          text.textContent = all.length ? "\u5F53\u524D\u7C7B\u578B\u7B5B\u9009\u4E0B\u6CA1\u6709\u7ED3\u679C\u3002" : annotations ? scope ? "\u672C\u6279\u6B21\u672A\u53D1\u73B0\u5019\u9009\u3002" : "\u6682\u65E0\u7B5B\u67E5\u7ED3\u679C\u3002" : "\u6253\u5F00 CSV \u540E\u53EF\u5F00\u59CB\u7B5B\u67E5\u3002";
          list.append(text);
        }
        items.forEach((e) => {
          const row = document2.createElement("div");
          row.className = "event-row";
          const text = document2.createElement("div");
          text.className = "event-text";
          const title = document2.createElement("strong");
          title.style.color = eventColors[e.type];
          title.textContent = displayText(e.type) + " \xB7 " + (e.end - e.start).toFixed(3) + " \u79D2";
          const detail = document2.createElement("small");
          detail.textContent = eventClock(e.start) + " \u2014 " + eventClock(e.end) + " \xB7 " + (e.mode === "engineering" ? "\u4F30\u7B97\u5C55\u5F00\u65F6\u95F4" : "\u539F\u59CB\u79D2\u7EA7\u65F6\u95F4") + " \xB7 " + displayText(e.channels.join("\u3001"));
          if (isBaseline(e.detection_profile)) detail.textContent += " \xB7 " + (isPatientFlow(e.detection_profile) ? "\u60A3\u8005\u6D41\u91CFv4 \xB7 " : isOptimized(e.detection_profile) ? e.detection_profile === "dynamic_baseline_v3" ? "\u4F18\u5316v3 \xB7 " : "\u4F18\u5316v2 \xB7 " : "") + baselineMethodLabel(e.detection_method, e.detection_profile) + " / " + e.detection_window_seconds + "\u79D2\u7A97\u53E3" + (["dynamic_baseline_v3", "patient_flow_v4"].includes(e.detection_profile) ? " / \u6301\u7EED\u2265" + eventDuration(e) + "\u79D2" : "");
          const note = document2.createElement("small");
          note.textContent = displayText(e.note);
          const noteBox = document2.createElement("details"), noteTitle = document2.createElement("summary");
          noteBox.className = "event-note";
          noteTitle.textContent = "\u7B97\u6CD5\u8BF4\u660E / \u5907\u6CE8";
          noteBox.append(noteTitle, note);
          text.append(title, detail);
          if (e.evidence?.review_flags?.length) {
            const hints = document2.createElement("small");
            hints.className = "event-hints";
            hints.textContent = displayText(e.evidence.review_flags.join("\uFF1B"));
            text.append(hints);
          }
          text.append(noteBox);
          if (isPatientFlow(e.detection_profile) && e.evidence) {
            const box = document2.createElement("details"), summary = document2.createElement("summary"), body = document2.createElement("small"), thresholdTime = Number.isFinite(e.evidence.threshold_met_at) ? e.evidence.threshold_met_at : e.evidence.confirmed_at;
            summary.textContent = "\u67E5\u770B\u60A3\u8005\u6D41\u91CF\u5019\u9009\u4F9D\u636E";
            body.textContent = "\u60A3\u8005\u547C\u5438\u6D41\u91CF\uFF08L/min\uFF09 \xB7 \u7EDD\u5BF9\u503C\u5E45\u5EA6 \xB7 \u4E24\u7C7B\u5019\u9009\u5747\u6309\u539F\u59CB\u6E90\u79D2\u8FDE\u7EED\u8FBE\u6807\u81F3\u5C1110\u79D2\uFF0C\u5E76\u6709\u4E3B\u7A97\u53E3\u652F\u6301 \xB7 \u6682\u505C\u5269\u4F59\u226410%\uFF0C\u4F4E\u901A\u6C14\u5269\u4F59\u226470%\u3002" + (Number.isFinite(e.evidence.main_reference_amplitude) ? " \u4E3B\u7A97\u53E3\u53C2\u8003 " + e.evidence.main_reference_amplitude.toFixed(3) + " L/min\u3002" : "") + (Number.isFinite(e.evidence.remaining_ratio_median) ? " \u4E3B\u7A97\u53E3\u5269\u4F59\u4E2D\u4F4D " + (e.evidence.remaining_ratio_median * 100).toFixed(1) + "%\u3002" : "") + " \u95E8\u9650\u8FBE\u6807\u65F6\u95F4 " + (Number.isFinite(thresholdTime) ? eventClock(thresholdTime) : "\u672A\u8BB0\u5F55") + "\uFF1B\u7ED3\u679C\u5F62\u6210\u65F6\u95F4 " + (Number.isFinite(e.evidence.finalized_at) ? eventClock(e.evidence.finalized_at) : "\u672A\u8BB0\u5F55") + "\u3002\u4F4E\u901A\u6C14\u5019\u9009\u7F3A\u5C11\u8840\u6C27\u4E0B\u964D\u6216\u89C9\u9192\u8BC1\u636E\u3002" + (Array.isArray(e.evidence.review_flags) ? e.evidence.review_flags.join("\uFF1B") : "");
            box.append(summary, body);
            text.append(box);
          }
          if (isOptimized(e.detection_profile) && e.evidence) {
            const v = e.evidence, box = document2.createElement("details"), summary = document2.createElement("summary"), body = document2.createElement("small"), range = (a) => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) ? a.map(eventClock).join(" \u2014 ") : "\u672A\u8BB0\u5F55";
            summary.textContent = "\u539F\u59CB\u4F18\u5316\u5224\u5B9A\u4F9D\u636E";
            body.textContent = (v.boundary_basis === "main_window_end" && !v.onset_backtrack_seconds && !v.recovery_trim_seconds && !v.normal_low_phase_review ? "\u4E3B\u7A97\u53E3\u8FDE\u7EED\u8FBE\u6807\u533A\u95F4 " : "\u4F30\u8BA1\u6CE2\u5F62\u533A\u95F4 ") + range(v.estimated_waveform_interval) + (v.onset_backtrack_seconds || v.recovery_trim_seconds || v.normal_low_phase_review ? " \xB7 \u4FEE\u6B63\u540E\u6301\u7EED " : v.boundary_basis === "main_window_end" ? " \xB7 \u4E3B\u7A97\u53E3\u8FDE\u7EED " : " \xB7 1\u79D2\u590D\u6838\u8FDE\u7EED ") + (v.boundary_duration_seconds ?? "\u672A\u77E5") + "\u79D2 \xB7 \u4E3B\u7A97\u53E3\u7236\u8FC7\u7A0B\u8FBE\u6807 " + (v.main_qualified_total_seconds ?? "\u672A\u77E5") + "\u79D2\uFF0C\u533A\u95F4\uFF1A" + (Array.isArray(v.main_qualified_intervals) ? v.main_qualified_intervals.map(range).join("\uFF1B") : "\u672A\u8BB0\u5F55") + " \xB7 \u786E\u8BA4 " + (Number.isFinite(v.confirmed_at) ? eventClock(v.confirmed_at) : "\u672A\u8BB0\u5F55") + (v.extremely_low_strength ? " \xB7 \u8FDE\u7EED" + (v.minimum_duration ?? 10) + "\u79D2\u226410%\u6781\u4F4E\u5F3A\u5EA6\u6807\u8BB0" : "") + "\u3002" + (Array.isArray(v.review_flags) ? v.review_flags.join("\uFF1B") : "");
            if (v.threshold_boundary_review) body.textContent += " \xB7 \u8F83\u65E9\u7EC8\u70B9 " + eventClock(v.threshold_boundary_review.alternative_end) + "\uFF08" + v.threshold_boundary_review.alternative_duration_seconds + " \u79D2\uFF09\uFF1B\u539F\u7EC8\u70B9 " + eventClock(v.estimated_waveform_interval[1]);
            if (Number.isFinite(v.recovery_trim_seconds)) body.textContent += " \xB7 \u539F\u5224\u5B9A\u7EC8\u70B9 " + eventClock(v.unadjusted_end) + "\uFF0C\u6309\u6D41\u91CF\u6062\u590D\u7F29\u77ED " + v.recovery_trim_seconds + " \u79D2";
            if (Number.isFinite(v.recovery_cycle_seconds)) body.textContent += " \xB7 \u6062\u590D\u6CE2\u52A8\u95F4\u9694\u7EA6 " + v.recovery_cycle_seconds + " \u79D2\uFF0C\u590D\u6838\u4E8E " + eventClock(v.recovery_confirmed_at);
            if (Number.isFinite(v.rhythm_period_seconds)) body.textContent += (v.rhythm_basis === "earlier" ? " \xB7 \u8F83\u65E9\u8282\u5F8B\uFF08\u4EC5\u7528\u4E8E\u8D77\u70B9\uFF09\u7EA6 " : " \xB7 \u8FD1\u671F\u8282\u5F8B\u7EA6 ") + v.rhythm_period_seconds + " \u79D2/\u5468\u671F" + (v.rhythm_interval_count ? "\uFF08" + v.rhythm_interval_count + " \u4E2A\u4E00\u81F4\u95F4\u9694\uFF09" : "") + "\uFF0C\u8D77\u70B9\u56DE\u770B\u8303\u56F4 " + (v.flow_tail_search_seconds ?? v.weak_onset_search_seconds) + " \u79D2";
            if (Number.isFinite(v.onset_backtrack_seconds)) body.textContent += " \xB7 \u539F\u4E3B\u7A97\u53E3\u8D77\u70B9 " + eventClock(v.unadjusted_start) + "\uFF0C\u6309\u6D41\u91CF\u63D0\u524D " + v.onset_backtrack_seconds + " \u79D2";
            if (v.normal_low_phase_review) {
              const phase = v.normal_low_phase_review;
              body.textContent += (phase.low_phase_basis === "independent_phase_mean" ? " \xB7 \u8FD1\u671F\u4F4E\u6D41\u91CF\u9636\u6BB5\u5E73\u5747 " : phase.low_phase_basis === "independent_phase" ? " \xB7 \u72EC\u7ACB\u4F30\u8BA1\u4F4E\u6D41\u91CF\u9636\u6BB5\uFF0C\u4E0A\u9650 " : " \xB7 \u5178\u578B\u4F4E\u6D41\u91CF\u9636\u6BB5\u7EA6 ") + phase.low_phase_seconds + " \u79D2\uFF08" + phase.low_phase_count + " \u4E2A\u4E00\u81F4\u6837\u672C\uFF09\uFF0C\u4ECE " + eventClock(phase.waveform_start) + " \u540E\u79FB " + phase.delayed_seconds + " \u79D2\u518D\u8BA1\u65F6";
            }
            if (v.flow_recovery_breaks?.length) body.textContent += " \xB7 \u539F\u59CB\u6D41\u91CF\u8BC6\u522B\u5230 " + v.flow_recovery_breaks.length + " \u6B21\u6301\u7EED\u56DE\u5347\u5E76\u56DE\u843D\uFF0C\u5DF2\u5206\u6BB5\u590D\u6838";
            if (v.normal_low_phase_review?.low_phase_reference_basis === "held_non_event_history") body.textContent += " \xB7 \u6CBF\u7528\u4E8B\u4EF6\u524D\u7684\u6709\u6548\u5C3E\u6BB5\u53C2\u8003\uFF0C\u6700\u65B0\u6837\u672C\u8DDD\u8D77\u70B9 " + v.normal_low_phase_review.low_phase_reference_age_seconds.toFixed(1) + " \u79D2";
            if (v.unconfirmed_low_phase_review) {
              const phase = v.unconfirmed_low_phase_review;
              body.textContent += " \xB7 \u8D77\u70B9\u5F85\u590D\u6838\uFF1A\u8FD1\u671F\u4F4E\u4F4D\u9636\u6BB5\u5E73\u5747 " + phase.low_phase_seconds.toFixed(2) + " \u79D2\uFF0C\u4F46\u672C\u6B21\u6CE2\u5F62\u672A\u786E\u8BA4\u8D85\u8FC7\u53C2\u8003\u65F6\u957F\u540E\u4ECD\u6301\u7EED\u4F4E\u4F4D";
            }
            if (v.post_inspiratory_pause_review) {
              const phase = v.post_inspiratory_pause_review;
              body.textContent += " \xB7 \u9AD8\u6D41\u91CF\u7ED3\u675F\u540E\u7684\u5E38\u89C1\u95F4\u9694\u7EA6 " + phase.pause_seconds + " \u79D2\uFF08" + phase.sample_count + " \u4E2A\u4E00\u81F4\u5468\u671F\uFF09\uFF0C\u9884\u8BA1 " + eventClock(phase.expected_low_second) + " \u8FDB\u5165\u4F4E\u6D41\u91CF\u76F8\uFF1B\u89C2\u5BDF\u5230\u4E2D\u95F4\u5E73\u53F0\u6301\u7EED\uFF0C\u672A\u89C1\u9884\u671F\u6CE2\u5F62\u53D8\u5316" + (phase.delayed_seconds ? "\uFF0C\u8D77\u70B9\u540E\u79FB " + phase.delayed_seconds + " \u79D2" : "");
            }
            if (Number.isFinite(v.weak_tail_trim_seconds)) body.textContent += " \xB7 \u56DE\u6EAF\u8D77\u70B9 " + eventClock(v.weak_tail_start) + " \u4ECD\u5728\u8D8B\u7A33\uFF0C\u5254\u9664\u5C3E\u6BB5 " + v.weak_tail_trim_seconds + " \u79D2";
            if (Number.isFinite(v.flow_tail_trim_seconds)) body.textContent += " \xB7 \u539F\u59CB\u8D77\u70B9 " + eventClock(v.unadjusted_start) + "\uFF0C\u6D41\u91CF\u8D8B\u7A33\u540E\u5F00\u59CB\u8BA1\u65F6\uFF08\u7F29\u77ED " + v.flow_tail_trim_seconds + " \u79D2\uFF09";
            if (Array.isArray(v.leak_change_context) && v.leak_change_context.length) body.textContent += " \xB7 \u603B\u6F0F\u6C14\u5B57\u6BB5\u53D8\u5316\uFF1A" + v.leak_change_context.map((s) => eventClock(s.time) + " " + s.before + "\u2192" + s.after + " L/min").join("\uFF1B");
            box.append(summary, body);
            text.append(box);
          }
          if (["adaptive_multifeature", "dynamic_baseline"].includes(e.detection_profile) && e.evidence) {
            const v = e.evidence, box = document2.createElement("details"), summary = document2.createElement("summary"), body = document2.createElement("small"), num = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "\u672A\u77E5";
            summary.textContent = "\u539F\u59CB\u81EA\u52A8\u5224\u5B9A\u4F9D\u636E";
            body.textContent = "\u53C2\u8003B " + num(v.reference_amplitude) + " L/min \xB7 \u5F3A\u5EA6/A\u4E2D\u4F4D " + num(v.amplitude_median ?? v.strength_median) + " L/min \xB7 \u5269\u4F59\u4E2D\u4F4D " + num(v.remaining_ratio_median * 100, 1) + "% / \u6700\u5927 " + num(v.remaining_ratio_max * 100, 1) + "% \xB7 \u4E25\u683C\u8FBE\u6807 " + num(v.strict_duration_seconds, 0) + " \u79D2 \xB7 \u9996\u6B21\u786E\u8BA4 " + (Number.isFinite(v.confirmed_at) ? eventClock(v.confirmed_at) : "\u672A\u77E5") + "\u3002" + (Array.isArray(v.review_flags) ? v.review_flags.join("\uFF1B") : "");
            box.append(summary, body);
            text.append(box);
          }
          row.append(text);
          const jump = document2.createElement("button");
          jump.type = "button";
          jump.textContent = "\u5B9A\u4F4D";
          jump.setAttribute("aria-label", "\u5B9A\u4F4D\u5230\u6CE2\u5F62 " + displayText(e.type) + " " + e.start.toFixed(3));
          jump.onclick = () => jumpEvent(e);
          row.append(jump);
          list.append(row);
        });
        list.scrollTop = previousScroll;
      }
      function jumpEvent(e) {
        if (isPatientFlow(e.detection_profile)) patientInitialized = true;
        const panelScroll = $("event-list").scrollTop || 0;
        if (isBaseline(e.detection_profile)) {
          rememberProfileControls(e.detection_profile);
          if (e.detection_profile === "dynamic_baseline_v2") optimizedInitialized = true;
          if (e.detection_profile === "dynamic_baseline_v3") v3Initialized = true;
          $("baseline-method").value = e.detection_method;
          $("baseline-window").value = String(e.detection_window_seconds);
          selectDetectionProfile(e.detection_profile, true);
          $("scan-profile").onchange();
          $("baseline-method").value = e.detection_method;
          $("baseline-window").value = String(e.detection_window_seconds);
          $("scan-duration").value = eventDuration(e);
          updateBaselineControls();
        }
        if (e.detection_profile === "adaptive_multifeature" && e.evidence) {
          selectDetectionProfile("adaptive_multifeature", true);
          $("scan-profile").onchange();
          $("scan-duration").value = e.evidence.minimum_duration;
          $("scan-ratio").value = Math.round(e.evidence.remaining_entry_ratio * 100);
          $("adaptive-version").value = e.detection_version;
        }
        const margin = Math.max(1, (e.end - e.start) * 0.5);
        setView(e.start - margin, e.end + margin, 0);
        refreshEventVisibility();
        $("event-list").scrollTop = panelScroll;
        const fileId = meta.file_id;
        requestAnimationFrame(() => {
          if (meta?.file_id === fileId) scrollToEventWaveform(e);
        });
        $("status").textContent = "\u4FDD\u6301\u5F53\u524D\u663E\u793A\u6A21\u5F0F\uFF1B\u4E8B\u4EF6\u8BA1\u65F6\u4F9D\u636E\uFF1A" + (e.mode === "raw" ? "\u539F\u59CB\u79D2\u7EA7\u65F6\u95F4" : "\u4F30\u7B97\u5C55\u5F00\u65F6\u95F4");
      }
      function scrollToEventWaveform(e) {
        const panels = [...$("plots").querySelectorAll(".wave-panel")], priorities = [...e.channels.filter((n) => !analysisDerivedNames.includes(n)), ...e.channels];
        let target;
        for (const channel of priorities) {
          target = panels.find((p) => groups.find((g) => g[0] === p.dataset.name)?.includes(channel));
          if (target) break;
        }
        (target || $("plots")).scrollIntoView?.({ block: "start", behavior: "smooth" });
      }
      function downloadEvents(kind) {
        if (!annotations) return error("\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u6807\u8BB0\u8BB0\u5F55");
        let content, mime;
        if (kind === "json") {
          content = JSON.stringify(annotations.export(), null, 2);
          mime = "application/json";
        } else {
          const safe = (v) => '"' + String(v).replace(/^[=+@\-]/, "'$&").replace(/"/g, '""') + '"';
          const rows = [["id", "\u7C7B\u578B", "\u8D77\u59CB\u65F6\u95F4", "\u7ED3\u675F\u65F6\u95F4", "\u6301\u7EED\u79D2\u6570", "\u8D77\u59CB\u504F\u79FB\u79D2", "\u7ED3\u675F\u504F\u79FB\u79D2", "\u901A\u9053", "\u65F6\u95F4\u8F74", "\u6765\u6E90", "\u5907\u6CE8"], ...annotations.items.map((e) => [e.id, e.type, eventClock(e.start), eventClock(e.end), (e.end - e.start).toFixed(3), e.start, e.end, e.channels.join(";"), e.mode, e.source + " / " + e.status, e.note])];
          content = "\uFEFF" + rows.map((row) => row.map(safe).join(",")).join("\r\n");
          mime = "text/csv;charset=utf-8";
        }
        const url = URL2.createObjectURL(new Blob([content], { type: mime })), a = document2.createElement("a");
        a.href = url;
        a.download = meta.name.replace(/\.csv$/i, "") + ".events." + kind;
        a.click();
        setTimeout(() => URL2.revokeObjectURL(url), 1e3);
      }
      $("export-events-json").onclick = () => downloadEvents("json");
      $("export-events-csv").onclick = () => downloadEvents("csv");
      $("import-events").onchange = async (e) => {
        const input = e.target, file = input.files[0];
        if (!file) return;
        try {
          if (!annotations) throw Error("\u8BF7\u5148\u6253\u5F00\u6570\u636E\u6587\u4EF6");
          if (file.size > 10 * 1024 * 1024) throw Error("\u6807\u8BB0JSON\u8BF7\u5C0F\u4E8E10MB");
          const packet = JSON.parse(await file.text());
          await commitShared((m) => m.import(packet));
          renderEventList();
          scheduleCursor();
          $("status").textContent = usesSessionEvents() ? "\u4E8B\u4EF6\u5DF2\u5BFC\u5165\u5F53\u524D\u4F1A\u8BDD" : "\u4E8B\u4EF6\u5DF2\u5BFC\u5165\u672C\u673A\u5171\u4EAB\u5B58\u50A8";
        } catch (err) {
          error(err);
        } finally {
          input.value = "";
        }
      };
      window2.setInterval?.(() => {
        if (annotations && eventSyncReady && !document2.hidden && !eventSaving) refreshSharedEvents(false);
      }, 3e3);
      api("/api/meta").then(init).catch(() => {
        $("info").textContent = "\u8BF7\u70B9\u51FB\u53F3\u4E0A\u89D2\u6253\u5F00 CSV";
        $("status").textContent = "\u5C1A\u672A\u52A0\u8F7D\u6587\u4EF6";
      });
      function applyShared(packet) {
        serverRevision = packet.revision;
        annotations.items = packet.events.map((e) => annotations.validate(e));
        eventSyncReady = true;
        renderEventList();
        scheduleCursor();
      }
      async function refreshSharedEvents(initial = false) {
        if (!annotations || eventSaving) return;
        const model = annotations, fileId = meta.file_id;
        try {
          let packet = await api("/api/events?file_id=" + encodeURIComponent(fileId));
          if (annotations !== model || eventSaving) return;
          const marker = model.key + ":shared-migrated";
          if (initial && !usesSessionEvents() && !localStorage.getItem(marker)) {
            const merged = new Map(packet.events.map((e) => [e.id, model.validate(e)]));
            for (const e of model.items) {
              const normalized = model.validate(e);
              if (merged.has(e.id) && JSON.stringify(merged.get(e.id)) !== JSON.stringify(normalized)) throw Error("\u65E7\u6D4F\u89C8\u5668\u6807\u8BB0\u4E0E\u5171\u4EAB\u8BB0\u5F55\u51B2\u7A81\uFF0C\u8BF7\u5148\u5BFC\u51FAJSON\u5907\u4EFD\u540E\u624B\u52A8\u5904\u7406");
              merged.set(e.id, normalized);
            }
            if (merged.size !== packet.events.length) packet = await api("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId, revision: packet.revision, events: [...merged.values()] }) });
            if (annotations !== model) return;
            localStorage.setItem(marker, "1");
          }
          if (!eventSyncReady || packet.revision !== serverRevision) applyShared(packet);
        } catch (e) {
          error(e);
        }
      }
      async function commitShared(mutate) {
        if (!eventSyncReady || !annotations) throw Error("\u5171\u4EAB\u5B58\u50A8\u5C1A\u672A\u540C\u6B65\uFF0C\u8BF7\u7A0D\u5019\u6216\u5237\u65B0\u9875\u9762");
        if (eventSaving) throw Error("\u6B63\u5728\u4FDD\u5B58\u4E0A\u4E00\u4E2A\u64CD\u4F5C\uFF0C\u8BF7\u7A0D\u5019");
        eventSaving = true;
        const model = annotations, fileId = meta.file_id;
        try {
          const draft = new AnnotationModel(meta, { setItem() {
          }, getItem() {
            return null;
          } });
          draft.items = model.items.map((e) => ({ ...e, channels: [...e.channels] }));
          mutate(draft);
          const packet = await api("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fileId, revision: serverRevision, events: draft.items }) });
          if (annotations !== model) return;
          applyShared(packet);
          try {
            model.commit(packet.events);
          } catch (e) {
            error("\u4E8B\u4EF6\u5DF2\u4FDD\u5B58\u5230\u672C\u673A\uFF0C\u6D4F\u89C8\u5668\u5907\u4EFD\u5931\u8D25\uFF1A" + e.message);
          }
        } finally {
          eventSaving = false;
        }
      }
      let scanning = false;
      async function scanRecording(whole) {
        if (fileSwitching) return error("\u6587\u4EF6\u6B63\u5728\u5207\u6362\uFF0C\u8BF7\u7A0D\u5019\u518D\u626B\u63CF");
        if (!meta || !eventSyncReady) return error("\u8BF7\u5148\u6253\u5F00\u6587\u4EF6\u5E76\u7B49\u5F85\u6807\u8BB0\u540C\u6B65\u5B8C\u6210");
        if (!primaryProfiles.includes($("scan-profile").value)) return error("\u6B64\u7B97\u6CD5\u4EC5\u4FDD\u7559\u5386\u53F2\u67E5\u770B\uFF0C\u8BF7\u9009\u62E9\u60A3\u8005\u6D41\u91CFv4\u3001\u5E45\u5EA6\u89C4\u5219\u6216\u52A8\u6001\u57FA\u7EBF\u4F18\u5316v3\u540E\u626B\u63CF");
        if (scanning || eventSaving) return;
        const minDuration = isPatientFlow($("scan-profile").value) ? 10 : Number($("scan-duration").value), ratio = Number($("scan-ratio").value) / 100;
        if (isPatientFlow($("scan-profile").value) && !meta.patient_flow_v4_version) return error("\u8BF7\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\u5E76\u5237\u65B0\u7F51\u9875\u540E\u4F7F\u7528\u60A3\u8005\u6D41\u91CF\u4F18\u5316v4");
        if (isOptimized($("scan-profile").value) && !optimizedAvailable($("scan-profile").value)) return error("\u8BF7\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\u5E76\u5237\u65B0\u7F51\u9875\u540E\u4F7F\u7528\u4F18\u5316\u6D4B\u8BD5\u7248");
        if ($("scan-profile").value === "dynamic_baseline" && meta.dynamic_baseline_detector_version !== "dynamic-baseline-detector-v1") return error("\u8BF7\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\u5E76\u5237\u65B0\u7F51\u9875\u540E\u4F7F\u7528\u52A8\u6001\u57FA\u7EBF\u68C0\u6D4B");
        if ($("scan-profile").value === "adaptive_test" && (meta.adaptive_test_version !== "adaptive-flow-test-v2-causal" || !meta.channels.includes("\u6D4B\u8BD5\u5E45\u5EA6A\uFF085\u79D2\u9C81\u68D2\uFF09") || ratio <= 0.1)) return error("\u6D4B\u8BD5\u7B97\u6CD5\u9700\u8981\u66F4\u65B0\u540E\u7684\u540E\u53F0\u53CACSV\u6D41\u91CF\uFF0C\u51CF\u5F31\u6BD4\u4F8B\u5E94\u5927\u4E8E10%\u3002");
        if ($("scan-profile").value === "adaptive_multifeature" && (meta.multifeature_test_version !== "adaptive-flow-test-v3-multifeature" || ratio <= 0.1)) return error("\u591A\u7279\u5F81\u6D4B\u8BD5\u9700\u8981\u66F4\u65B0\u540E\u7684\u540E\u53F0\u53CACSV\u6D41\u91CF\uFF0C\u8BF7\u91CD\u542F\u67E5\u770B\u5668\u540E\u5237\u65B0\uFF1B\u51CF\u5F31\u5269\u4F59\u6BD4\u4F8B\u987B\u5927\u4E8E10%\u3002");
        if ($("scan-profile").value === "company_rules" && amplitudeSource() === "csv_flow" && !meta.channels.includes("\u6D41\u91CF\u6CE2\u52A8\u5E45\u5EA6A\uFF085\u79D2\u6781\u5DEE\uFF09")) return error("\u5F53\u524D\u6587\u4EF6\u6216\u540E\u53F0\u5C1A\u672A\u63D0\u4F9B\u6D41\u91CF\u5E45\u5EA6A\u3002\u8BF7\u786E\u8BA4\u6709CSV\u6D41\u91CF\u5217\uFF0C\u5E76\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\u3001\u91CD\u65B0\u6253\u5F00CSV\u3002");
        const eventTypes = [...chosenDetectionTypes];
        if (!eventTypes.length) return error("\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u79CD\u68C0\u6D4B\u4E8B\u4EF6\uFF0C\u6216\u70B9\u51FB\u201C\u5168\u68C0\u6D4B\u201D");
        if (!Number.isFinite(minDuration) || minDuration < 3 || minDuration > 120 || !Number.isFinite(ratio) || ratio < 0.05 || ratio > 0.8) return error("\u6700\u77ED\u6301\u7EED\u9700\u4E3A3\uFF5E120\u79D2\uFF0C\u6CE2\u52A8\u6BD4\u4F8B\u9700\u4E3A5\uFF5E80%");
        const model = annotations, fileId = meta.file_id;
        scanning = true;
        eventSaving = true;
        $("scan-all").disabled = $("scan-window").disabled = true;
        $("scan-types-fieldset").disabled = true;
        $("scan-profile").disabled = true;
        $("baseline-method").disabled = $("baseline-window").disabled = $("baseline-duration").disabled = true;
        $("device-metrics").replaceChildren();
        $("scan-result").textContent = "\u6B63\u5728\u5206\u6790\u539F\u59CB\u6837\u672C\uFF0C\u8BF7\u7A0D\u5019\u2026";
        try {
          const start = whole ? 0 : Math.min(view[0], meta.raw_duration), end = whole ? meta.raw_duration : Math.min(view[1], meta.raw_duration);
          const baseline = isBaseline($("scan-profile").value);
          const scanArgs = { file_id: fileId, start, end, min_duration: minDuration, reduction_ratio: isPatientFlow($("scan-profile").value) ? 0.7 : baseline ? 0.5 : $("scan-profile").value === "company_rules" ? 0.3 : ratio, profile: $("scan-profile").value, event_types: eventTypes, flow_source: baseline || isAdaptive($("scan-profile").value) ? "csv_flow" : amplitudeSource(), ...baseline ? baselineArgs() : {} };
          const existing = await api("/api/scans/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scanArgs) });
          if (annotations !== model) return;
          if (existing.match) {
            const action = await chooseDuplicateScan(existing.match);
            if (annotations !== model) return;
            if (action !== "rescan") {
              if (action === "reuse") {
                await loadFeedbackRuns(existing.match.run_id);
                await showScanBatch(existing.match.run_id);
                await loadDeviceMetrics();
                $("scan-result").textContent = "\u5DF2\u663E\u793A\u6240\u9009\u6279\u6B21\u3002";
              } else $("scan-result").textContent = "\u5DF2\u53D6\u6D88\u626B\u63CF\uFF0C\u672A\u65B0\u589E\u6279\u6B21\u3002";
              return;
            }
          }
          const result = await api("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scanArgs) });
          if (annotations !== model) return;
          applyShared(result.packet);
          await loadFeedbackRuns(result.packet.run_id);
          await showScanBatch(result.packet.run_id);
          $("scan-result").textContent = "\u626B\u63CF\u5B8C\u6210\uFF1A\u68C0\u51FA " + result.detected_count + " \u6761\uFF0C\u65B0\u589E " + result.added + " \u6761\uFF0C\u8DF3\u8FC7\u5DF2\u6709\u91CD\u53E0\u8BB0\u5F55 " + result.skipped + " \u6761\u3002\u6709\u6548\u53C2\u8003\u533A\u95F4 " + result.eligible_seconds + " \u79D2\u3002\u5019\u9009\u6309\u539F\u59CB\u65F6\u95F4\u5B9A\u4F4D\u3002" + displayText(result.warnings.join(" "));
          showDeviceMetrics(result.device_metrics);
          renderEventList();
          if (scanArgs.profile === "adaptive_multifeature") $("adaptive-version").value = "adaptive-flow-test-v3-multifeature";
          if (baseline) $("baseline-all-configs").checked = false;
          setResultGroup(baseline ? "baseline" : isAdaptive(scanArgs.profile) ? "adaptive" : scanArgs.profile === "company_rules" ? "company" : "automatic");
        } catch (err) {
          const message = err.message.includes("\u68C0\u6D4B\u65B9\u6848\u65E0\u6548") ? "\u7F51\u9875\u4E0E\u8FD0\u884C\u4E2D\u7684\u540E\u53F0\u7248\u672C\u4E0D\u4E00\u81F4\u3002\u8BF7\u5173\u95ED\u65E7\u67E5\u770B\u5668\u8FD0\u884C\u7A97\u53E3\uFF0C\u91CD\u65B0\u53CC\u51FB\u672C\u9879\u76EE\u7684\u201C\u542F\u52A8\u67E5\u770B\u5668.cmd\u201D\uFF0C\u7136\u540E\u5237\u65B0\u7F51\u9875\u5E76\u91CD\u65B0\u6253\u5F00CSV\u3002" : err.message;
          error(message);
          $("scan-result").textContent = "\u626B\u63CF\u672A\u5B8C\u6210\uFF1A" + message;
        } finally {
          scanning = false;
          eventSaving = false;
          $("scan-all").disabled = $("scan-window").disabled = false;
          $("scan-types-fieldset").disabled = false;
          $("scan-profile").disabled = false;
          $("baseline-method").disabled = $("baseline-window").disabled = $("baseline-duration").disabled = false;
          updateBaselineControls();
        }
      }
      $("scan-all").onclick = () => scanRecording(true);
      $("scan-window").onclick = () => scanRecording(false);
      $("scan-profile").onchange = () => {
        const profile = $("scan-profile").value;
        rememberProfileControls(profile);
        const testing = isAdaptive(profile), multi = profile === "adaptive_multifeature", baseline = isBaseline(profile);
        prepareBaselineProfile(profile);
        if (primaryProfiles.includes(profile)) {
          selectDetectionProfile(profile);
          if (baseline) activeBaselineProfile = profile;
        }
        if (!scanning) $("scan-all").disabled = $("scan-window").disabled = !primaryProfiles.includes(profile);
        if (["engineering", "device_candidates"].includes(profile)) activeAutomaticProfile = profile;
        $("optimized-rule-info").hidden = profile !== "dynamic_baseline_v2";
        $("optimized-v3-rule-info").hidden = profile !== "dynamic_baseline_v3";
        $("patient-flow-rule-info").hidden = !isPatientFlow(profile);
        $("baseline-options").hidden = !baseline;
        $("baseline-rule-info").hidden = profile !== "dynamic_baseline";
        $("show-company-a").textContent = baseline ? "\u663E\u793A\u5F3A\u5EA6\u4E0E\u57FA\u7EBF" : "\u663E\u793A\u8F93\u5165\u4E0EA";
        $("scan-duration").disabled = baseline;
        $("test-rule-info").hidden = profile !== "adaptive_test";
        $("multi-rule-info").hidden = !multi;
        const company = profile === "company_rules";
        $("scan-ratio").value = isPatientFlow(profile) ? 70 : testing || baseline ? 50 : profile === "device_candidates" ? 70 : 30;
        $("scan-ratio-label").hidden = company || baseline;
        $("amplitude-source-label").hidden = !company;
        $("company-rule-info").hidden = !company;
        $("relative-rule-info").hidden = company || testing || baseline;
        $("scan-duration").value = company || testing ? 7 : 10;
        restoreProfileControls(profile);
        updateBaselineControls();
        $("device-metrics").replaceChildren();
        chosenDetectionTypes = new Set(detectionTypes[profile]);
        renderDetectionChoices();
        if (testing) $("adaptive-version").value = multi ? "adaptive-flow-test-v3-multifeature" : "adaptive-flow-test-v2-causal";
        setResultGroup(baseline ? "baseline" : testing ? "adaptive" : company ? "company" : "automatic");
        pruneProfileChannels();
        refreshMultiPlots();
      };
      function rememberProfileControls(next) {
        if (previousDetectionProfile && previousDetectionProfile !== next) profilePreferences.set(previousDetectionProfile, { method: $("baseline-method").value, window: $("baseline-window").value, duration: $("scan-duration").value });
        previousDetectionProfile = next;
      }
      function restoreProfileControls(profile) {
        const saved = profilePreferences.get(profile);
        if (saved) {
          $("baseline-method").value = saved.method;
          $("baseline-window").value = saved.window;
          $("scan-duration").value = saved.duration;
        }
        if (isPatientFlow(profile)) {
          $("baseline-method").value = "absolute_mean";
          $("scan-duration").value = 10;
        }
      }
      function refreshMultiPlots() {
        if (meta && selected.some((n) => multiNames.includes(n))) {
          cache = null;
          data = {};
          loadWave(true);
        }
      }
      $("scan-ratio").onchange = refreshMultiPlots;
      $("scan-duration").onchange = refreshMultiPlots;
      function showDeviceMetrics(m) {
        const host = $("device-metrics");
        host.hidden = activeResultGroup !== "automatic";
        host.replaceChildren();
        if (!m) return;
        host.textContent = "\u8BBE\u5907\u65B9\u6848\u6700\u8FD1\u4E00\u6B21\u626B\u63CF\u5019\u9009\u7EDF\u8BA1\uFF08\u672A\u4EBA\u5DE5\u786E\u8BA4\uFF09\uFF1A\u6240\u9009\u6D41\u91CF\u7C7B\u578B\u5019\u9009\u65F6\u957F " + (m.total_candidate_duration_seconds === null ? "\u672A\u68C0\u6D4B" : m.total_candidate_duration_seconds + " \u79D2") + "\uFF1B" + Object.entries(m.by_type).map(([type, v]) => type + (v.count === null ? " \u672A\u68C0\u6D4B" : " " + v.count + " \u6761 / " + v.duration_seconds + " \u79D2")).join("\uFF1B") + "\u3002\u4E2D\u67A2\u6027\u6682\u505C\u65F6\u957F\uFF1A\u4E0D\u53EF\u5224\u5B9A\uFF1B\u4E34\u5E8A\u4F4E\u901A\u6C14\u65F6\u957F\uFF1A\u4E0D\u53EF\u5224\u5B9A\uFF1BAHI\uFF1A\u4E0D\u53EF\u8BA1\u7B97\u3002\u603B\u65F6\u957F\u6309\u672C\u6B21\u52FE\u9009\u7684\u6D41\u91CF\u5019\u9009\u533A\u95F4\u5E76\u96C6\u8BA1\u7B97\uFF0C\u4E0D\u542B\u6F0F\u6C14\u4E0E\u6570\u636E\u8D28\u91CF\u4E8B\u4EF6\u3002\u5217\u8868\u4FDD\u7559\u65E7\u65B9\u6848\u8BB0\u5F55\uFF0C\u8BF7\u52FF\u4E0E\u672C\u65B9\u6848\u91CD\u590D\u7D2F\u8BA1\u3002\u4EBA\u5DE5\u4FEE\u6539\u540E\u8BF7\u67E5\u770B\u4E8B\u4EF6\u5217\u8868\uFF0C\u6B64\u5904\u4FDD\u7559\u626B\u63CF\u539F\u7ED3\u679C\u3002";
      }
      async function loadDeviceMetrics() {
        if (!meta) return;
        const fid = meta.file_id;
        try {
          const result = await api("/api/device-summary?file_id=" + encodeURIComponent(fid));
          if (meta?.file_id === fid) showDeviceMetrics(result.device_metrics);
        } catch (e) {
          if (meta?.file_id === fid) error(e);
        }
      }
      function visibleEvents(items) {
        return items.filter((e) => e.status !== "ignored" && matchesResultGroup(e, activeResultGroup) && visibleEventTypes.has(e.type));
      }
      function refreshEventVisibility() {
        renderEventList();
        scheduleCursor();
      }
      function renderDetectionChoices() {
        const host = $("scan-type-options");
        host.replaceChildren();
        const available = detectionTypes[$("scan-profile").value] || detectionTypes.device_candidates;
        for (const type of available) {
          const label = document2.createElement("label"), input = document2.createElement("input");
          input.type = "checkbox";
          input.checked = chosenDetectionTypes.has(type);
          input.value = type;
          input.onchange = () => {
            if (input.checked) chosenDetectionTypes.add(type);
            else chosenDetectionTypes.delete(type);
            updateDetectionSummary();
          };
          label.append(input, document2.createTextNode(displayText(type)));
          host.append(label);
        }
        updateDetectionSummary();
      }
      function updateDetectionSummary() {
        const count = chosenDetectionTypes.size, total = (detectionTypes[$("scan-profile").value] || detectionTypes.device_candidates).length;
        $("scan-type-summary").textContent = count === total ? "\u5168\u68C0\u6D4B\uFF08" + total + " \u7C7B\uFF09" : count ? "\u5DF2\u9009 " + count + " / " + total + " \u7C7B" : "\u8BF7\u9009\u62E9\u68C0\u6D4B\u7C7B\u578B";
      }
      function renderDisplayChoices() {
        const host = $("display-type-options");
        host.replaceChildren();
        for (const type of displayTypesForCurrentGroup()) {
          const label = document2.createElement("label"), input = document2.createElement("input");
          input.type = "checkbox";
          input.value = type;
          input.checked = visibleEventTypes.has(type);
          input.onchange = () => {
            if (input.checked) visibleEventTypes.add(type);
            else visibleEventTypes.delete(type);
            refreshEventVisibility();
          };
          label.append(input, document2.createTextNode(displayText(type)));
          host.append(label);
        }
      }
      $("adaptive-version").onchange = refreshEventVisibility;
      $("result-adaptive").onclick = () => setResultGroup("adaptive");
      $("result-auto").onclick = () => {
        $("scan-profile").value = activeAutomaticProfile;
        $("scan-profile").onchange();
      };
      $("result-company").onclick = () => {
        selectDetectionProfile("company_rules");
        $("scan-profile").onchange();
      };
      $("result-manual").onclick = () => setResultGroup("manual");
      $("result-baseline").onclick = () => {
        selectDetectionProfile("dynamic_baseline_v3");
        $("scan-profile").onchange();
      };
      $("baseline-all-configs").onchange = () => {
        if ($("baseline-all-configs").checked && meta) scanViews.delete(meta.file_id);
        setResultGroup("baseline");
      };
      for (const id of ["baseline-method", "baseline-window"]) $(id).onchange = () => {
        if (scanning) return;
        updateBaselineControls();
        setResultGroup("baseline");
        const plotting = selected.some((n) => allDynamicNames.includes(n) || allOptimizedNames.includes(n) || allPatientNames.includes(n));
        pruneProfileChannels();
        if (meta && plotting) showBaselineDetectionCurves();
      };
      function groupMultiEvidence() {
        groups = groups.map((g) => g.filter((n) => !multiNames.includes(n))).filter((g) => g.length);
        groups.push([multiNames[0], multiNames[1], multiNames[2], multiNames[3], multiNames[6]], [multiNames[4], multiNames[5]]);
      }
      function showBaselineDetectionCurves() {
        if (!meta || fileSwitching) return error("\u8BF7\u5148\u6253\u5F00\u6587\u4EF6\u5E76\u7B49\u5F85\u5207\u6362\u5B8C\u6210");
        const profile = $("scan-profile").value, optimized = isOptimized(profile), b = baselineArgs(), patient = isPatientFlow(profile), wanted = patient ? patientNames(b.window_seconds) : optimized ? optimizedNames(b.window_seconds, profile) : dynamicNames(b.window_seconds);
        if ((patient ? !meta.patient_flow_v4_version : optimized ? !optimizedAvailable(profile) : meta.dynamic_baseline_version !== "dynamic-baseline-comparison-v1") || wanted.some((n) => !meta.channels.includes(n))) return error("\u8BF7\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\uFF0C\u518D\u5237\u65B0\u7F51\u9875");
        selected = [.../* @__PURE__ */ new Set([...selected.filter((n) => !analysisDerivedNames.includes(n)), "\u6D41\u91CF", ...wanted])];
        if (optimized && b.dynamic_method !== "detrended_abs") selected = selected.filter((n) => n !== wanted[5]);
        groups = groups.map((g) => g.filter((n) => selected.includes(n) && !allDynamicNames.includes(n) && !allOptimizedNames.includes(n) && !allPatientNames.includes(n))).filter((g) => g.length);
        groups.push(wanted.slice(0, 4), [wanted[4]]);
        if (patient) groups.push(wanted.slice(5));
        if (optimized) {
          groups.push(wanted.slice(6));
          if (b.dynamic_method === "detrended_abs") groups.push([wanted[5]]);
        }
        $("channels").querySelectorAll("input").forEach((c) => c.checked = selected.includes(c.dataset.name));
        filterChannels();
        cache = null;
        data = {};
        loadWave(true);
        $("status").textContent = patient ? "\u5DF2\u663E\u793A\u60A3\u8005\u6D41\u91CF\u7EDD\u5BF9\u503C\u5E45\u5EA6\u3001\u53C2\u8003\u3001\u6682\u505C/\u4F4E\u901A\u6C14\u95E8\u9650\u3001\u5269\u4F59\u6BD4\u4F8B\u4E0E1\u79D2\u590D\u6838\u66F2\u7EBF\u3002\u4F4E\u901A\u6C14\u5019\u9009\u7F3A\u5C11\u8840\u6C27\u4E0B\u964D\u6216\u89C9\u9192\u8BC1\u636E\u3002" : optimized ? "\u5DF2\u663E\u793A\u4F18\u5316\u6D4B\u8BD5\u7684\u4E3B\u7A97\u53E3\u30011\u79D2\u590D\u6838\u5F3A\u5EA6/\u53C2\u8003\u53CA\u80CC\u666F\u4F30\u8BA1\uFF08\u4EC5\u53BB\u80CC\u666F\u6CD5\uFF09\u3002\u4F30\u8BA1\u533A\u95F4\u3001\u4E3B\u7A97\u53E3\u8FBE\u6807\u533A\u95F4\u548C\u786E\u8BA4\u65F6\u523B\u5206\u5F00\u8BB0\u5F55\u3002" : "\u5DF2\u663E\u793A\u5F53\u524D\u68C0\u6D4B\u65B9\u6CD5\u548C\u7A97\u53E3\u5BF9\u5E94\u7684\u5F3A\u5EA6\u3001\u53C2\u8003\u300125%/50%\u95E8\u9650\u548C\u5269\u4F59\u6BD4\u4F8B\uFF1B\u5019\u9009\u53EF\u5728\u300C\u7B5B\u67E5\u7ED3\u679C\u300D\u4E2D\u67E5\u770B\u3002";
      }
      $("show-company-a").onclick = () => {
        if (isBaseline($("scan-profile").value)) return showBaselineDetectionCurves();
        if (!meta) return error("\u8BF7\u5148\u6253\u5F00CSV");
        const names = amplitudeChannels(), available = names.filter((n) => meta.channels.includes(n));
        if (available.length < 2) return error("\u6240\u9009\u8F93\u5165\u6216A\u901A\u9053\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u542F\u66F4\u65B0\u540E\u7684\u67E5\u770B\u5668\u5E76\u91CD\u65B0\u6253\u5F00CSV");
        selected = [.../* @__PURE__ */ new Set([...selected, ...available])];
        if ($("scan-profile").value === "adaptive_multifeature") groupMultiEvidence();
        else {
          groups = groups.map((g) => g.filter((n) => n !== names[1])).filter((g) => g.length);
          groups.push([names[1]]);
        }
        $("channels").querySelectorAll("input").forEach((c) => c.checked = selected.includes(c.dataset.name));
        filterChannels();
        cache = null;
        loadWave(true);
        $("status").textContent = $("scan-profile").value === "adaptive_multifeature" ? "\u5DF2\u663E\u793AA\u3001\u53C2\u8003B\u3001\u4E25\u683C\u6BD4\u4F8B\u95E8\u9650\u548C\u5269\u4F59/\u4E0B\u964D\u767E\u5206\u6BD4\uFF1B\u5BF9\u5E94\u5F53\u524D\u53C2\u6570\uFF0C\u566A\u58F0\u4EE3\u7406\u672A\u6807\u5B9A\u3002" : $("scan-profile").value === "adaptive_test" ? "\u5DF2\u663E\u793ACSV\u6D41\u91CF\u548C\u6D4B\u8BD5\u9C81\u68D2A\uFF1B\u5B9E\u9645\u51BB\u7ED3\u53C2\u8003\u4E0E\u8FDF\u6EDE\u95E8\u9650\u89C1\u5019\u9009\u4F9D\u636E\uFF1B\u4E0D\u7ED8\u5236\u56FA\u5B9A10/17\u9608\u503C\u3002" : "\u5DF2\u663E\u793A\u6240\u9009\u8F93\u5165\u53CA5\u79D2\u5E45\u5EA6A\uFF1B\u6BCF\u79D2\u66F4\u65B0\uFF0C\u524D5\u79D2\u53CA\u65E0\u6548\u7A97\u53E3\u7559\u7A7A\uFF0C\u865A\u7EBF\u4E3A10\u548C17\u3002";
      };
      $("amplitude-source").onchange = () => {
        pruneProfileChannels();
        if (activeResultGroup === "company") setResultGroup("company");
        if (meta) $("show-company-a").onclick();
      };
      $("scan-types-all").onclick = () => {
        chosenDetectionTypes = new Set(detectionTypes[$("scan-profile").value] || detectionTypes.device_candidates);
        renderDetectionChoices();
      };
      $("scan-types-none").onclick = () => {
        chosenDetectionTypes.clear();
        renderDetectionChoices();
      };
      $("display-types-all").onclick = () => {
        visibleEventTypes = new Set(Object.keys(eventColors));
        renderDisplayChoices();
        refreshEventVisibility();
      };
      $("display-types-none").onclick = () => {
        visibleEventTypes.clear();
        renderDisplayChoices();
        refreshEventVisibility();
      };
      async function loadFeedbackRuns(preferred) {
        if (!meta) return;
        const fileId = meta.file_id;
        const serial2 = ++feedbackSerial;
        try {
          const old = preferred || $("feedback-run").value, query = new URLSearchParams({ file_id: fileId, limit: 10, selected: old || "" }), packet = await api("/api/scans?" + query);
          if (meta?.file_id !== fileId || serial2 !== feedbackSerial) return;
          const select = $("feedback-run");
          select.replaceChildren();
          const runs = [...packet.scans];
          if (packet.selected && !runs.some((r) => r.run_id === packet.selected.run_id)) runs.unshift(packet.selected);
          for (const run of runs) {
            const option = document2.createElement("option");
            option.value = run.run_id;
            option.textContent = scanLabel(run, true);
            option.title = scanLabel(run);
            select.append(option);
          }
          if ([...select.options].some((o) => o.value === old)) select.value = old;
          if (!runs.length) {
            const option = document2.createElement("option");
            option.value = "";
            option.textContent = "\u6682\u65E0\u672A\u5F52\u6863\u6279\u6B21\uFF0C\u53EF\u67E5\u770B\u5386\u53F2\u6216\u6267\u884C\u626B\u63CF";
            select.append(option);
          }
          $("feedback-batch-info").textContent = "\u6700\u8FD110\u6B21\u672A\u5F52\u6863\u6279\u6B21 \xB7 \u5171 " + packet.total + " \u6B21" + (runs.length > packet.scans.length ? "\uFF08\u53E6\u4FDD\u7559\u5F53\u524D\u9009\u4E2D\u6279\u6B21\uFF09" : "");
        } catch (e) {
          error(e);
        }
      }
      function scanLabel(run, compact = false) {
        const local = new Date(run.created_at).toLocaleString("zh-CN", { hour12: false }), title = compact && run.title.length > 24 ? run.title.slice(0, 24) + "\u2026" : run.title;
        return (run.settings.profile === "patient_flow_v4" ? "[\u60A3\u8005\u6D41\u91CFv4] " : "") + (run.settings.profile === "company_rules" ? "[" + (run.settings.flow_source === "csv_flow" ? "CSV\u6D41\u91CF" : "\u538B\u529B\u4F30\u7B97Q") + "] " : "") + displayText((run.archived ? "[\u5DF2\u5F52\u6863] " : "") + title + " \xB7 " + local + "\uFF08\u672C\u5730\uFF09 \xB7 " + run.detected_count + "\u6761" + (compact ? "" : " \xB7 " + run.settings.version + " \xB7 " + (run.settings.event_types || ["\u539F\u65B9\u6848\u5168\u90E8\u7C7B\u578B"]).join("\u3001")));
      }
      let historyOffset = 0, historySerial = 0, feedbackSerial = 0, duplicateScanResolve = null;
      function chooseDuplicateScan(run) {
        $("duplicate-scan-text").textContent = "\u76F8\u540C\u6587\u4EF6\u3001\u65F6\u95F4\u8303\u56F4\u3001\u89C4\u5219\u7248\u672C\u3001\u53C2\u6570\u548C\u68C0\u6D4B\u7C7B\u578B\u5DF2\u6709\u626B\u63CF\uFF1A" + scanLabel(run) + "\u3002\u4F7F\u7528\u5DF2\u6709\u6279\u6B21\u4E0D\u4F1A\u65B0\u5EFA\u5FEB\u7167\uFF1B\u4ECD\u7136\u626B\u63CF\u4F1A\u4FDD\u7559\u4E00\u4EFD\u65B0\u7684\u5FEB\u7167\u3002";
        return new Promise((resolve) => {
          duplicateScanResolve = resolve;
          $("duplicate-scan-dialog").showModal();
        });
      }
      function finishDuplicateScan(action) {
        const resolve = duplicateScanResolve;
        duplicateScanResolve = null;
        $("duplicate-scan-dialog").close();
        resolve?.(action);
      }
      $("duplicate-use").onclick = () => finishDuplicateScan("reuse");
      $("duplicate-rescan").onclick = () => finishDuplicateScan("rescan");
      $("duplicate-cancel").onclick = () => finishDuplicateScan("cancel");
      $("duplicate-scan-dialog").oncancel = (e) => {
        e.preventDefault();
        finishDuplicateScan("cancel");
      };
      async function loadScanHistory() {
        if (!meta) return;
        const fid = meta.file_id, serial2 = ++historySerial;
        $("history-error").textContent = "";
        try {
          const q = new URLSearchParams({ file_id: fid, limit: 20, offset: historyOffset, q: $("history-query").value.trim(), state: $("history-state").value || "active" }), packet = await api("/api/scans?" + q);
          if (meta?.file_id !== fid || serial2 !== historySerial) return;
          if (historyOffset >= packet.total && historyOffset > 0) {
            historyOffset = Math.max(0, Math.floor((packet.total - 1) / 20) * 20);
            return loadScanHistory();
          }
          const host = $("history-list");
          host.replaceChildren();
          for (const run of packet.scans) {
            const row = document2.createElement("div");
            row.className = "history-row";
            const text = document2.createElement("p");
            text.textContent = scanLabel(run);
            row.append(text);
            const name = document2.createElement("input");
            name.value = run.title;
            name.maxLength = 100;
            name.setAttribute("aria-label", "\u6279\u6B21\u540D\u79F0 " + run.title);
            row.append(name);
            const button = (label, fn) => {
              const b = document2.createElement("button");
              b.type = "button";
              b.textContent = label;
              b.onclick = async () => {
                b.disabled = true;
                try {
                  await fn();
                } catch (e) {
                  $("history-error").textContent = e.message;
                } finally {
                  b.disabled = false;
                }
              };
              row.append(b);
            };
            const edit = async (change) => {
              await api("/api/scans/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fid, run_id: run.run_id, ...change }) });
              if (meta?.file_id !== fid) return;
              if (change.archived && $("feedback-run").value === run.run_id) $("feedback-run").value = "";
              await loadFeedbackRuns();
              await loadScanHistory();
            };
            button("\u4FDD\u5B58\u540D\u79F0", () => edit({ title: name.value }));
            button("\u9009\u7528\u6279\u6B21", async () => {
              if (meta?.file_id !== fid) return;
              await loadFeedbackRuns(run.run_id);
              if (meta?.file_id === fid) $("scan-history-dialog").close();
            });
            button(run.archived ? "\u6062\u590D\u5230\u5E38\u7528\u5217\u8868" : "\u5F52\u6863", () => edit({ archived: !run.archived }));
            host.append(row);
          }
          if (!packet.scans.length) {
            const p = document2.createElement("p");
            p.textContent = "\u6682\u65E0\u7B26\u5408\u6761\u4EF6\u7684\u6279\u6B21\u3002";
            host.append(p);
          }
          $("history-page").textContent = "\u7B2C " + (packet.total ? Math.floor(historyOffset / 20) + 1 : 0) + " / " + Math.ceil(packet.total / 20) + " \u9875 \xB7 \u5171 " + packet.total + " \u6B21";
          $("history-prev").disabled = historyOffset === 0;
          $("history-next").disabled = historyOffset + 20 >= packet.total;
        } catch (e) {
          if (meta?.file_id === fid) $("history-error").textContent = e.message;
        }
      }
      $("feedback-history").onclick = () => {
        if (!meta) return error("\u8BF7\u5148\u6253\u5F00CSV");
        historyOffset = 0;
        $("scan-history-dialog").showModal();
        loadScanHistory();
      };
      $("history-close").onclick = () => $("scan-history-dialog").close();
      $("history-search").onclick = () => {
        historyOffset = 0;
        loadScanHistory();
      };
      $("history-state").onchange = $("history-search").onclick;
      $("history-query").onkeydown = (e) => {
        if (e.key === "Enter") $("history-search").onclick();
      };
      $("history-prev").onclick = () => {
        historyOffset = Math.max(0, historyOffset - 20);
        loadScanHistory();
      };
      $("history-next").onclick = () => {
        historyOffset += 20;
        loadScanHistory();
      };
      function downloadJsonPacket(packet, suffix) {
        const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }), url = URL2.createObjectURL(blob), a = document2.createElement("a");
        a.href = url;
        a.download = meta.name.replace(/\.csv$/i, "") + "." + packet.run_id + "." + suffix + ".json";
        a.click();
        setTimeout(() => URL2.revokeObjectURL(url), 1e3);
      }
      async function exportAutomaticFeedback() {
        if (!meta || !$("feedback-run").value) return error("\u8BF7\u5148\u6267\u884C\u626B\u63CF\u5E76\u9009\u62E9\u626B\u63CF\u6279\u6B21");
        if (eventSaving || scanning) return error("\u8BF7\u7B49\u5F85\u5F53\u524D\u7B5B\u67E5\u6216\u5BFC\u5165\u5B8C\u6210");
        try {
          const fid = meta.file_id, runId = $("feedback-run").value;
          const packet = await api("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: fid, run_id: runId, kind: "automatic" }) });
          if (meta?.file_id === fid) downloadJsonPacket(packet, "automatic");
        } catch (e) {
          error(e);
        }
      }
      $("feedback-refresh").onclick = () => loadFeedbackRuns();
      $("export-automatic").onclick = exportAutomaticFeedback;
      api("/api/health").then((p) => {
        $("app-version").textContent = "\u7248\u672C " + p.app_version + " \xB7 \u672C\u673A\u8FD0\u884C \xB7 \u7814\u53D1\u8BD5\u7528";
      }).catch(() => {
      });
      let sidebarFrame = 0;
      function resizeSidebar() {
        for (const [selector, variable] of [[".channel-sidebar", "--sidebar-height"], ["#event-panel", "--event-panel-height"]]) {
          const sidebar = document2.querySelector(selector);
          if (!sidebar || sidebar.hidden) continue;
          if (selector === "#event-panel" && eventPanelIsDrawer()) {
            const bottom = $("toggle-events").getBoundingClientRect().bottom;
            if (Number.isFinite(bottom)) sidebar.style.setProperty("--results-drawer-top", Math.ceil(bottom + 6) + "px");
          }
          const top = Math.max(16, sidebar.getBoundingClientRect().top);
          sidebar.style.setProperty(variable, Math.max(selector === ".channel-sidebar" ? 120 : 180, window2.innerHeight - top - 16) + "px");
        }
      }
      function scheduleSidebarResize() {
        if (sidebarFrame) return;
        sidebarFrame = requestAnimationFrame(() => {
          sidebarFrame = 0;
          resizeSidebar();
        });
      }
      function scheduleEmbeddedAnalysisLayout() {
        if (!embeddedAnalysis || !embeddedAnalysisVisible || embeddedLayoutFrame) return;
        embeddedLayoutFrame = requestAnimationFrame(() => {
          embeddedLayoutFrame = 0;
          if (!embeddedAnalysisVisible || document2.documentElement?.clientWidth === 0 || window2.innerHeight === 0) return;
          overviewImage = null;
          cache = null;
          updateEventPanelChrome();
          scheduleSidebarResize();
          scheduleRender();
          if (meta) loadWave(true);
        });
      }
      function handleEmbeddedAnalysisVisibility(event) {
        if (!embeddedAnalysis || event.source !== window2.parent || event.origin !== window2.location.origin) return;
        const message = event.data;
        if (!message || message.source !== "data-workbench" || message.type !== "analysis:visibility" || typeof message.visible !== "boolean") return;
        embeddedAnalysisVisible = message.visible;
        if (message.visible) scheduleEmbeddedAnalysisLayout();
      }
      window2.addEventListener("message", handleEmbeddedAnalysisVisibility);
      window2.addEventListener("scroll", scheduleSidebarResize, { passive: true });
      window2.addEventListener("resize", scheduleSidebarResize);
      $("baseline-duration").onchange = () => {
        if (scanning) return;
        if (isPatientFlow($("scan-profile").value)) {
          updateBaselineControls();
          return;
        }
        $("scan-duration").value = Number($("baseline-duration").value);
        updateBaselineControls();
        cache = null;
        setResultGroup("baseline");
        const plotting = selected.some((n) => n.startsWith("\u4F18\u5316v3"));
        if (plotting) showBaselineDetectionCurves();
      };
      $("show-feedback-run").onclick = () => {
        if (scanning || eventSaving || fileSwitching) return error("\u8BF7\u7B49\u5F85\u5F53\u524D\u626B\u63CF\u6216\u4FDD\u5B58\u5B8C\u6210");
        showScanBatch($("feedback-run").value, true).catch(error);
      };
      if (primaryProfiles.includes($("scan-profile").value)) $("scan-profile").onchange();
      let eventPanelOpen = true, embeddedEventDrawerOpen = false;
      function eventPanelIsDrawer() {
        return window2.matchMedia?.("(max-width:1100px)").matches || false;
      }
      function isEventPanelOpen() {
        return embeddedAnalysis && eventPanelIsDrawer() ? embeddedEventDrawerOpen : eventPanelOpen;
      }
      function updateEventPanelChrome() {
        if (embeddedAnalysis && !eventPanelIsDrawer()) embeddedEventDrawerOpen = false;
        const open = isEventPanelOpen();
        $("event-panel").hidden = !open;
        document2.body?.classList?.toggle("event-panel-collapsed", !open);
        $("event-panel-backdrop").hidden = !open || !eventPanelIsDrawer();
        $("toggle-events").ariaExpanded = String(open);
      }
      function setEventPanelOpen(open) {
        if (embeddedAnalysis && eventPanelIsDrawer()) embeddedEventDrawerOpen = open;
        else {
          eventPanelOpen = open;
          try {
            localStorage.setItem("respiratory-event-panel-open-v1", String(open));
          } catch (e) {
          }
        }
        updateEventPanelChrome();
        overviewImage = null;
        cache = null;
        scheduleSidebarResize();
        if (meta) {
          scheduleRender();
          loadWave(true);
        }
      }
      $("toggle-events").onclick = () => setEventPanelOpen(!isEventPanelOpen());
      const waveSettingsToggle = $("toggle-wave-settings"), waveSettingsPanel = $("wave-settings-panel");
      waveSettingsToggle.onclick = () => {
        const open = waveSettingsPanel.hidden;
        waveSettingsPanel.hidden = !open;
        waveSettingsToggle.ariaExpanded = String(open);
        scheduleSidebarResize();
      };
      $("result-current").onclick = () => setResultGroup(resultGroupForProfile($("scan-profile").value));
      function closeEventDrawer() {
        setEventPanelOpen(false);
        $("toggle-events").focus?.();
      }
      $("event-panel-backdrop").onclick = closeEventDrawer;
      window2.addEventListener("resize", () => {
        updateEventPanelChrome();
        scheduleSidebarResize();
      });
      window2.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || document2.querySelector("dialog[open]")) return;
        if (!waveSettingsPanel.hidden && (waveSettingsPanel.contains?.(document2.activeElement) || document2.activeElement === waveSettingsToggle)) {
          waveSettingsToggle.onclick();
          waveSettingsToggle.focus();
        } else if (isEventPanelOpen() && eventPanelIsDrawer()) closeEventDrawer();
      });
      eventPanelOpen = embeddedAnalysis || !eventPanelIsDrawer();
      try {
        const saved = localStorage.getItem("respiratory-event-panel-open-v1");
        if (saved !== null) eventPanelOpen = saved === "true";
      } catch (e) {
      }
      updateEventPanelChrome();
      if (isEventPanelOpen() && eventPanelIsDrawer()) scheduleSidebarResize();
      if (embeddedAnalysis) {
        let updateChannels = function() {
          if (!narrow?.matches) narrowOpen = false;
          const open = isOpen();
          panel.hidden = !open;
          document2.body.classList.toggle("channel-panel-collapsed", !open);
          toggle.setAttribute("aria-expanded", String(open));
        }, setChannelsOpen = function(open) {
          if (narrow?.matches) narrowOpen = open;
          else desktopOpen = open;
          updateChannels();
          scheduleEmbeddedAnalysisLayout();
        };
        for (const id of ["analysis-notes", "scan-options", "external-tools"]) $(id).open = false;
        const narrow = window2.matchMedia?.("(max-width:760px)");
        const toggle = $("toggle-channels"), close = $("close-channel-panel"), panel = $("channel-panel");
        let desktopOpen = false, narrowOpen = false;
        const isOpen = () => narrow?.matches ? narrowOpen : desktopOpen;
        toggle.hidden = close.hidden = false;
        toggle.onclick = () => {
          const open = !isOpen();
          setChannelsOpen(open);
          if (open && narrow?.matches) close.focus();
        };
        close.onclick = () => {
          setChannelsOpen(false);
          toggle.focus();
        };
        narrow?.addEventListener?.("change", updateChannels);
        updateChannels();
      }
      return () => {
        rememberFileView();
        controller?.abort();
        serial++;
        generation++;
      };
    }

    // somnus-waveform:D:\VVFLY\SomnusNext\event_detection\annotation-model.js
    var globalThis2 = {};
    var module2 = { exports: {} };
    (function(root) {
      "use strict";
      const types = ["\u7591\u4F3C\u6682\u505C", "\u7591\u4F3C\u4F4E\u901A\u6C14", "\u6F0F\u6C14", "\u6CE2\u5F62\u5F02\u5E38", "\u4F2A\u8FF9/\u5E72\u6270", "\u5176\u4ED6", "\u547C\u5438\u6CE2\u52A8\u51CF\u5F31", "\u603B\u6F0F\u6C14\u5347\u9AD8", "\u6570\u636E\u7F3A\u5931", "\u4FE1\u53F7\u5F02\u5E38", "\u6D41\u91CF\u6CE2\u52A8\u8FD1\u6D88\u5931\u5019\u9009", "\u6D41\u91CF\u6CE2\u52A8\u51CF\u5F31\u5019\u9009", "\u516C\u53F8\u6682\u505C\u5019\u9009", "\u516C\u53F8\u4F4E\u901A\u6C14\u5019\u9009", "\u6D4B\u8BD5\u8FD1\u6D88\u5931\u5019\u9009", "\u6D4B\u8BD5\u51CF\u5F31\u5019\u9009"];
      types.push("\u5F3A\u5EA6\u663E\u8457\u4E0B\u964D\u5019\u9009", "\u5F3A\u5EA6\u51CF\u5F31\u5019\u9009", "\u547C\u5438\u6682\u505C\u5019\u9009", "\u4F4E\u901A\u6C14\u5019\u9009");
      class AnnotationModel {
        constructor(meta, storage) {
          this.meta = meta;
          this.storage = storage;
          this.key = "respiratory-events-v1:" + meta.file_id;
          this.items = [];
        }
        validate(event) {
          if (!event || typeof event !== "object") throw Error("\u4E8B\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E");
          const start = event.start, end = event.end;
          if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw Error("\u7ED3\u675F\u65F6\u95F4\u5FC5\u987B\u665A\u4E8E\u8D77\u59CB\u65F6\u95F4\uFF0C\u8D77\u59CB\u65F6\u95F4\u4E0D\u80FD\u5C0F\u4E8E0");
          if (!["raw", "engineering"].includes(event.mode)) throw Error("\u4E8B\u4EF6\u7F3A\u5C11\u6709\u6548\u7684\u65F6\u95F4\u8F74\u6A21\u5F0F");
          const limit = event.mode === "engineering" ? this.meta.display_duration : this.meta.raw_duration;
          if (end > limit + 1e-6) throw Error("\u4E8B\u4EF6\u8D85\u51FA\u6587\u4EF6\u65F6\u95F4\u8303\u56F4");
          if (!types.includes(event.type)) throw Error("\u4E0D\u652F\u6301\u7684\u4E8B\u4EF6\u7C7B\u578B");
          if (!Array.isArray(event.channels) || !event.channels.length || event.channels.some((c) => !this.meta.channels.includes(c))) throw Error("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u6709\u6548\u901A\u9053");
          if (typeof event.note !== "string" || event.note.length > 2e3) throw Error("\u5907\u6CE8\u6700\u591A2000\u5B57");
          if (typeof event.id !== "string" || !event.id || event.id.length > 100) throw Error("\u4E8B\u4EF6\u7F16\u53F7\u65E0\u6548");
          const source = event.source || "manual", status = event.status || (["agent", "detector"].includes(source) ? "candidate" : "reviewed");
          if (!["manual", "agent", "detector"].includes(source) || !["candidate", "reviewed", "ignored"].includes(status)) throw Error("\u4E8B\u4EF6\u6765\u6E90\u6216\u72B6\u6001\u65E0\u6548");
          const result = { id: event.id, start, end, type: event.type, note: event.note, channels: [...new Set(event.channels)], mode: event.mode, source, status, updated_at: typeof event.updated_at === "string" ? event.updated_at : (/* @__PURE__ */ new Date()).toISOString() };
          if (source === "detector") {
            const profile = event.detection_profile ?? (event.type.startsWith("\u516C\u53F8") || event.note.includes("\u516C\u53F8\u89C4\u5219\u8BD5\u9A8C") ? "company_rules" : event.type.startsWith("\u6D41\u91CF\u6CE2\u52A8") ? "device_candidates" : "engineering");
            if (!["company_rules", "device_candidates", "engineering", "adaptive_test", "adaptive_multifeature", "dynamic_baseline", "dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(profile)) throw Error("\u4E8B\u4EF6\u68C0\u6D4B\u65B9\u6848\u6765\u6E90\u65E0\u6548");
            result.detection_profile = profile;
          }
          if (source === "detector" && event.detection_input !== void 0) {
            if (!["csv_flow", "pressure_q"].includes(event.detection_input)) throw Error("\u68C0\u6D4B\u8F93\u5165\u6765\u6E90\u65E0\u6548");
            result.detection_input = event.detection_input;
          }
          if (source === "detector" && ["adaptive_test", "adaptive_multifeature", "dynamic_baseline", "dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(result.detection_profile)) {
            const version = event.detection_version ?? event.note.match(/adaptive-flow-test-v[\w-]+/)?.[0] ?? "unknown";
            if (typeof version !== "string" || version.length > 80) throw Error("\u6D4B\u8BD5\u7B97\u6CD5\u7248\u672C\u65E0\u6548");
            result.detection_version = version;
          }
          if (source === "detector" && ["dynamic_baseline", "dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(result.detection_profile)) {
            const method = event.detection_method, window2 = event.detection_window_seconds;
            if (result.detection_profile === "patient_flow_v4" && method !== "absolute_mean") throw Error("\u60A3\u8005\u6D41\u91CFv4\u56FA\u5B9A\u4F7F\u7528\u7EDD\u5BF9\u503C\u5E45\u5EA6");
            if (!(["dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(result.detection_profile) ? ["absolute_mean", "centered_rms", "detrended_abs"] : ["absolute_mean", "centered_rms"]).includes(method) || !Number.isInteger(window2) || !(["dynamic_baseline_v3", "patient_flow_v4"].includes(result.detection_profile) ? window2 >= 1 && window2 <= 10 : [2, 5, 8].includes(window2))) throw Error("\u52A8\u6001\u57FA\u7EBF\u65B9\u6CD5\u6216\u7A97\u53E3\u65E0\u6548");
            result.detection_method = method;
            result.detection_window_seconds = window2;
          }
          if (source === "detector" && result.detection_profile === "patient_flow_v4") {
            if (event.detection_min_duration !== void 0 && event.detection_min_duration !== 10) throw Error("\u60A3\u8005\u6D41\u91CFv4\u6700\u77ED\u6301\u7EED\u56FA\u5B9A10\u79D2");
            result.detection_min_duration = 10;
          }
          if (source === "detector" && result.detection_profile === "dynamic_baseline_v3" && event.detection_min_duration !== void 0) {
            const duration = event.detection_min_duration;
            if (!Number.isInteger(duration) || duration < 5 || duration > 10) throw Error("\u4F18\u5316v3\u6700\u77ED\u6301\u7EED\u5E94\u4E3A5\uFF5E10\u79D2\u6574\u6570");
            result.detection_min_duration = duration;
          }
          if (source === "detector" && ["adaptive_multifeature", "dynamic_baseline", "dynamic_baseline_v2", "dynamic_baseline_v3", "patient_flow_v4"].includes(result.detection_profile) && event.evidence !== void 0) {
            const evidence = event.evidence;
            const finite = (v) => {
              if (typeof v === "number" && !Number.isFinite(v)) throw Error("\u68C0\u6D4B\u4F9D\u636E\u5FC5\u987B\u4E3A\u6709\u9650\u6570\u503C");
              if (v && typeof v === "object") Object.values(v).forEach(finite);
            };
            if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || evidence.schema !== 1) throw Error("\u68C0\u6D4B\u4F9D\u636E\u683C\u5F0F\u65E0\u6548");
            finite(evidence);
            const encoded = JSON.stringify(evidence);
            if (encoded.length > 1e4) throw Error("\u68C0\u6D4B\u4F9D\u636E\u8FC7\u957F");
            result.evidence = JSON.parse(encoded);
          }
          return result;
        }
        commit(items) {
          const checked = items.map((x) => this.validate(x));
          if (new Set(checked.map((x) => x.id)).size !== checked.length) throw Error("\u4E8B\u4EF6\u7F16\u53F7\u91CD\u590D");
          this.storage.setItem(this.key, JSON.stringify({ version: 1, file_id: this.meta.file_id, events: checked }));
          this.items = checked;
        }
        load() {
          const raw = this.storage.getItem(this.key);
          if (!raw) return;
          const packet = JSON.parse(raw);
          if (packet.version !== 1 || packet.file_id !== this.meta.file_id || !Array.isArray(packet.events)) throw Error("\u4FDD\u5B58\u7684\u6807\u8BB0\u6587\u4EF6\u683C\u5F0F\u4E0D\u517C\u5BB9");
          const checked = packet.events.map((e) => this.validate(e));
          if (new Set(checked.map((e) => e.id)).size !== checked.length) throw Error("\u4FDD\u5B58\u7684\u4E8B\u4EF6\u7F16\u53F7\u91CD\u590D");
          this.items = checked;
        }
        save(event) {
          const item = this.validate(event), items = this.items.filter((x) => x.id !== item.id);
          items.push(item);
          this.commit(items);
        }
        remove(id) {
          this.commit(this.items.filter((x) => x.id !== id));
        }
        export() {
          return { version: 1, file_id: this.meta.file_id, recording: { name: this.meta.name, start: this.meta.start, rows: this.meta.rows }, events: this.items };
        }
        import(packet) {
          if (packet?.version !== 1 || packet.file_id !== this.meta.file_id || !Array.isArray(packet.events)) throw Error("\u8BF7\u5BFC\u5165\u540C\u4E00\u4EFD CSV \u5BFC\u51FA\u7684\u4E8B\u4EF6 JSON \u6587\u4EF6");
          const merged = new Map(this.items.map((x) => [x.id, x]));
          for (const event of packet.events) {
            const valid = this.validate(event);
            if (merged.has(valid.id) && JSON.stringify(merged.get(valid.id)) !== JSON.stringify(valid)) throw Error("\u540C\u7F16\u53F7\u4E8B\u4EF6\u5185\u5BB9\u51B2\u7A81\uFF0C\u8BF7\u5148\u4FEE\u6539\u6216\u5220\u9664\u5BF9\u5E94\u4E8B\u4EF6");
            merged.set(valid.id, valid);
          }
          this.commit([...merged.values()]);
        }
      }
      root.AnnotationModel = AnnotationModel;
      root.annotationTypes = types;
      function compareReviewed(packet, meta) {
        if (packet?.kind !== "reviewed" || ![1, 2].includes(packet.version) || packet.file_id !== meta.file_id || packet.automatic?.file_id !== meta.file_id || packet.run_id !== packet.automatic.run_id || !Array.isArray(packet.events) || !Array.isArray(packet.automatic.events)) throw Error("\u8BF7\u9009\u62E9\u4E0E\u5F53\u524DCSV\u5339\u914D\u7684\u4EBA\u5DE5\u6821\u9A8CJSON");
        const model = new AnnotationModel(meta, { setItem() {
        } }), final = packet.events.map((e) => model.validate(e)), auto = packet.automatic.events.map((e) => model.validate(e));
        const current = new Map(final.map((e) => [e.id, e])), links = packet.automatic.event_links || {}, linked = /* @__PURE__ */ new Set(), rows = [];
        for (const original of auto) {
          const id = links[original.id] || original.id;
          linked.add(id);
          const e = current.get(id);
          let result;
          if (!e) result = "\u5DF2\u5220\u9664\uFF08\u4E0D\u80FD\u81EA\u52A8\u8BA4\u5B9A\u8BEF\u62A5\uFF09";
          else if (e.status === "ignored") result = "\u5DF2\u5FFD\u7565 / \u8BEF\u62A5\u5019\u9009";
          else if (e.status === "candidate") result = "\u5C1A\u672A\u786E\u8BA4";
          else result = [e.type !== original.type ? "\u7C7B\u578B\u8C03\u6574" : "", e.start !== original.start || e.end !== original.end ? "\u8FB9\u754C\u8C03\u6574" : ""].filter(Boolean).join("\u3001") || "\u5DF2\u786E\u8BA4\u4E00\u81F4";
          const range = packet.reviewed_range;
          if (!Array.isArray(range) || original.start < range[0] || original.end > range[1]) result = "\u5DF2\u68C0\u67E5\u8303\u56F4\u5916 \xB7 " + result;
          rows.push({ original, event: e || original, result });
        }
        for (const e of final) if (!linked.has(e.id) && e.source === "manual") rows.push({ original: null, event: e, result: "\u4EBA\u5DE5\u65B0\u589E / \u6F0F\u68C0\u590D\u6838\u7EBF\u7D22" });
        return rows;
      }
      root.compareReviewed = compareReviewed;
      if (typeof module2 !== "undefined") module2.exports = { AnnotationModel, types, compareReviewed };
    })(globalThis2);
    var annotation_model_default = module2.exports;

    // ../../../desktop/dsh_next/client/NativeWaveform.tsx
    function NativeWaveform({ active }) {
      const host = (0, import_react.useRef)(null);
      const visibility = (0, import_react.useRef)();
      const [error, setError] = (0, import_react.useState)("");
      (0, import_react.useEffect)(() => {
        const container = host.current;
        const shadow = container.shadowRoot || container.attachShadow({ mode: "open" });
        const parsed = new DOMParser().parseFromString(event_detection_default, "text/html");
        const body = document.createElement("div");
        body.tabIndex = 0;
        body.addEventListener("pointerdown", (event) => {
          if (event.target.tagName === "CANVAS") body.focus({ preventScroll: true });
        });
        body.className = `${parsed.body.className} analysis-embedded`;
        body.innerHTML = parsed.body.innerHTML;
        body.querySelectorAll("script").forEach((node) => node.remove());
        const style = document.createElement("style");
        const styles = [...parsed.querySelectorAll("style")].map((node) => node.textContent).join("\n") + dashboard_default + events_default;
        style.textContent = styles.replace(/:root/g, ":host").replace(/\bbody\b/g, ".events-page").replace(/\bhtml\b/g, ":host") + `
          :host {display:block;min-width:0;--text:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--border:var(--dsw-alias-border-l1);--primary:var(--dsw-alias-brand-primary);--bg:var(--dsw-alias-bg-base);--hover:var(--dsw-alias-bg-layer-2);--selected:var(--dsw-alias-interactive-bg-active)}
          .events-page {background:var(--dsw-alias-bg-base);color:var(--text)}
          .events-page.analysis-embedded {position:relative!important}
          .events-page.analysis-embedded .channel-sidebar {position:absolute!important;inset:0 auto 0 0!important;width:186px!important;height:100%!important;max-height:none!important;grid-column:auto!important;grid-row:auto!important;border-radius:0!important}
          .events-page.analysis-embedded > .sidebar, .events-page.analysis-embedded .events-global-header {display:none!important}
          .events-page :is(section,.channel-sidebar,.event-panel,.event-panel-head,.annotation-dialog,select,input,button,details.wave-settings) {background:var(--dsw-alias-bg-layer-1);color:var(--text);border-color:var(--border)}
        `;
        shadow.replaceChildren(style, body);
        const abort = new AbortController();
        let visible = active;
        const listeners = [];
        const messages = /* @__PURE__ */ new Set();
        const resizes = /* @__PURE__ */ new Set();
        const timeouts = /* @__PURE__ */ new Set(), intervals = /* @__PURE__ */ new Set(), frames = /* @__PURE__ */ new Set(), urls = /* @__PURE__ */ new Set();
        const timeout = (fn, delay) => {
          if (abort.signal.aborted) return 0;
          const id = window.setTimeout(() => {
            timeouts.delete(id);
            if (!abort.signal.aborted && typeof fn === "function") fn();
          }, delay);
          timeouts.add(id);
          return id;
        };
        const interval = (fn, delay) => {
          if (abort.signal.aborted) return 0;
          const id = window.setInterval(fn, delay);
          intervals.add(id);
          return id;
        };
        const frame = (fn) => {
          if (abort.signal.aborted) return 0;
          const id = window.requestAnimationFrame((time) => {
            frames.delete(id);
            if (!abort.signal.aborted) fn(time);
          });
          frames.add(id);
          return id;
        };
        const localWindow = new Proxy(window, { get(target, key) {
          if (key === "setTimeout") return timeout;
          if (key === "setInterval") return interval;
          if (key === "requestAnimationFrame") return frame;
          if (key === "matchMedia") return (query) => {
            const media = window.matchMedia(query);
            return new Proxy(media, { get(target2, property) {
              if (property === "addEventListener") return (name, listener) => {
                target2.addEventListener(name, listener);
                listeners.push(() => target2.removeEventListener(name, listener));
              };
              const value2 = Reflect.get(target2, property, target2);
              return typeof value2 === "function" ? value2.bind(target2) : value2;
            } });
          };
          if (key === "parent") return window;
          if (key === "location") return { origin: location.origin, search: "?embedded=1" };
          if (key === "addEventListener") return (name, fn, options) => {
            if (name === "message") messages.add(fn);
            if (name === "resize") resizes.add(fn);
            const source = name === "keydown" ? body : name === "scroll" ? container : window;
            source.addEventListener(name, fn, options);
            listeners.push(() => source.removeEventListener(name, fn, options));
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        const localDocument = new Proxy(document, { get(target, key) {
          if (key === "hidden") return !visible || document.hidden;
          if (key === "body" || key === "documentElement") return body;
          if (key === "activeElement") return shadow.activeElement;
          if (key === "getElementById") return (id) => body.querySelector("#" + CSS.escape(id));
          if (key === "querySelector" || key === "querySelectorAll") return body[key].bind(body);
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        const localURL = new Proxy(URL, { get(target, key) {
          if (key === "createObjectURL") return (blob) => {
            const url = URL.createObjectURL(blob);
            urls.add(url);
            return url;
          };
          if (key === "revokeObjectURL") return (url) => {
            urls.delete(url);
            URL.revokeObjectURL(url);
          };
          return Reflect.get(target, key);
        } });
        const request = (path, init = {}) => nativeFetch(path, {
          ...init,
          signal: init.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal
        });
        let dispose;
        try {
          dispose = mount(
            localDocument,
            localWindow,
            request,
            annotation_model_default.AnnotationModel,
            frame,
            window.cancelAnimationFrame.bind(window),
            timeout,
            window.clearTimeout.bind(window),
            interval,
            window.clearInterval.bind(window),
            localURL
          );
          visibility.current = (value) => {
            visible = value;
            const event = new MessageEvent("message", { data: { source: "data-workbench", type: "analysis:visibility", visible: value }, source: window, origin: location.origin });
            messages.forEach((listener) => listener(event));
          };
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "\u65E0\u6CD5\u52A0\u8F7D\u6CE2\u5F62\u5DE5\u5177");
        }
        const observer = new ResizeObserver(() => {
          if (!abort.signal.aborted) resizes.forEach((listener) => listener(new Event("resize")));
        });
        observer.observe(container);
        return () => {
          dispose?.();
          abort.abort();
          observer.disconnect();
          visibility.current = void 0;
          listeners.forEach((remove) => remove());
          timeouts.forEach((id) => window.clearTimeout(id));
          intervals.forEach((id) => window.clearInterval(id));
          frames.forEach((id) => window.cancelAnimationFrame(id));
          urls.forEach((url) => URL.revokeObjectURL(url));
          shadow.replaceChildren();
        };
      }, []);
      (0, import_react.useEffect)(() => {
        visibility.current?.(active);
      }, [active]);
      return /* @__PURE__ */ React.createElement(React.Fragment, null, error && /* @__PURE__ */ React.createElement("p", { role: "alert" }, error), /* @__PURE__ */ React.createElement("div", { ref: host, className: "somnus-native-waveform" }));
    }

    // ../../../desktop/dsh_next/client/native-tools.css
    var native_tools_default = ".somnus-native-tools {\n  box-sizing: border-box;\n  height: 100%;\n  min-height: 0;\n  overflow: auto;\n  padding: 24px;\n  padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px));\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  --shell-bg: var(--dsw-alias-bg-base);\n  --shell-surface: var(--dsw-alias-bg-layer-1);\n  --shell-line: var(--dsw-alias-border-l1);\n  --shell-ink: var(--dsw-alias-label-primary);\n  --shell-muted: var(--dsw-alias-label-secondary);\n  --shell-accent: var(--dsw-alias-brand-primary);\n  --shell-selected: var(--dsw-alias-interactive-bg-active);\n}\n\n.somnus-native-tools [hidden] { display: none !important; }\n.somnus-native-tools :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n\n/* heading */\n.somnus-tools-heading {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 12px 16px;\n  margin-bottom: 18px;\n}\n\n.somnus-tools-heading h1 { margin: 0; font-size: 24px; font-weight: 600; }\n\n.somnus-tools-heading p {\n  margin: 4px 0 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n}\n\n.somnus-tools-heading-actions {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n\n.somnus-tools-back {\n  min-height: 32px;\n  padding: 6px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 9px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12.5px;\n  cursor: pointer;\n}\n\n.somnus-tools-back:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n.somnus-tools-search {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  min-width: 250px;\n  height: 34px;\n  padding: 0 11px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 9px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.somnus-tools-search input {\n  width: 100%;\n  min-width: 0;\n  border: 0;\n  outline: none;\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  font-size: 12.5px;\n}\n\n/* tool grid */\n.somnus-tools-grid {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  gap: 14px;\n}\n\n.somnus-native-tools .somnus-tool-card {\n  position: relative;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  min-width: 0;\n  padding: 18px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 14px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: inherit;\n  font: inherit;\n  text-align: start;\n  text-decoration: none;\n  cursor: pointer;\n  transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease, opacity .18s ease;\n}\n\n.somnus-native-tools .somnus-tool-card:hover {\n  border-color: var(--dsw-alias-brand-primary);\n  transform: translateY(-1px);\n  box-shadow: 0 8px 22px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);\n}\n\n.somnus-tool-tile {\n  display: grid;\n  place-items: center;\n  width: 38px;\n  height: 38px;\n  margin-bottom: 2px;\n  border-radius: 11px;\n  background: var(--dsw-alias-interactive-bg-active);\n  color: var(--dsw-alias-brand-primary);\n}\n\n.somnus-tool-tile svg {\n  width: 20px;\n  height: 20px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.7;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\n\n.somnus-tool-name {\n  color: var(--dsw-alias-label-primary);\n  font-size: 14.5px;\n  font-weight: 650;\n}\n\n.somnus-tool-hint {\n  min-height: 38px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12.5px;\n  line-height: 1.6;\n}\n\n.somnus-tool-meta {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n  margin-top: auto;\n  padding-top: 4px;\n}\n\n.somnus-tool-tag {\n  display: inline-flex;\n  padding: 1px 7px;\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n}\n\n.somnus-tool-reason {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11.5px;\n  line-height: 1.55;\n}\n\n.somnus-tool-open {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin-top: 6px;\n  padding-top: 10px;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  color: var(--dsw-alias-brand-primary);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n/* not ready: desaturate but keep the card openable for configuration */\n.somnus-native-tools .somnus-tool-card[data-state=blocked] {\n  opacity: .75;\n  filter: saturate(.55);\n}\n\n.somnus-native-tools .somnus-tool-card[data-state=blocked]:hover {\n  opacity: 1;\n  transform: none;\n  border-color: var(--dsw-alias-border-l2);\n  box-shadow: none;\n}\n\n.somnus-native-tools .somnus-tool-card[data-state=blocked] .somnus-tool-open {\n  color: var(--dsw-alias-label-secondary);\n  font-weight: 500;\n}\n\n/* alerts and empty states */\n.somnus-tools-alert {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  margin: 0 0 14px;\n  padding: 10px 12px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 9px;\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12.5px;\n}\n\n.somnus-tools-alert button {\n  min-height: 26px;\n  padding: 2px 8px;\n  border: 1px solid currentColor;\n  border-radius: 6px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  font-size: 11.5px;\n  cursor: pointer;\n}\n\n.somnus-tools-empty {\n  padding: 46px 20px;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: 14px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n}\n\n.somnus-tools-empty h2 {\n  margin: 0 0 6px;\n  color: var(--dsw-alias-label-primary);\n  font-size: 15px;\n  font-weight: 600;\n}\n\n.somnus-tools-empty p {\n  max-width: 560px;\n  margin: 0 auto 14px;\n  font-size: 12.5px;\n  line-height: 1.7;\n}\n\n.somnus-tools-empty button {\n  min-height: 30px;\n  padding: 5px 12px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: transparent;\n  color: var(--dsw-alias-brand-primary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.somnus-tools-status {\n  padding: 32px 12px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 13px;\n  text-align: center;\n}\n\n@media (max-width: 1180px) {\n  .somnus-tools-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n}\n\n@media (max-width: 820px) {\n  .somnus-tools-grid { grid-template-columns: minmax(0, 1fr); }\n  .somnus-tools-heading-actions { width: 100%; }\n  .somnus-tools-search { flex: 1; min-width: 0; }\n}\n\n/* embedded tool surfaces keep the host tokens */\n.somnus-native-tools .sql-page,\n.somnus-native-tools .deep-analysis-page { height: auto; min-width: 0; }\n.somnus-native-tools .sql-layout { min-height: 500px; }\n.somnus-native-tools :is(.sql-panel,.sql-schema,.deep-runtime>div,.deep-file-box,.deep-file-summary,.deep-recent,.deep-recent-head,.deep-config,.deep-artifact,.deep-steps details,.deep-steps pre) { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }\n.somnus-native-tools :is(.sql-topbar,.sql-result,.sql-schema-head,.sql-topbar-title,.deep-heading h1,.deep-recent-text strong,.deep-file-summary>strong) { color: var(--dsw-alias-label-primary); background: transparent; border-color: var(--dsw-alias-border-l1); }\n.somnus-native-tools :is(.sql-hint,.deep-heading p,.deep-runtime>div>span:first-child,.deep-task-header small,.deep-recent-text small,.deep-input-note,.deep-config p,.deep-file-box>p) { color: var(--dsw-alias-label-secondary); }\n.somnus-native-tools .deep-recent-item { color: inherit; border-color: var(--dsw-alias-border-l1); }\n.somnus-native-tools .deep-recent-item:is(:hover,.active) { background: var(--dsw-alias-interactive-bg-active); }\n.somnus-native-tools .deep-answer { color: var(--dsw-alias-label-primary); }\n.somnus-native-tools .deep-answer :is(th,td,pre,code,blockquote) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }\n.somnus-native-tools .sql-result { overflow: auto; }\n\n@media (max-width: 600px) { .somnus-native-tools { padding: 16px; } }\n";

    // src/entry.tsx
    var PANEL_ID = "plugin-tool-waveform";
    var LOCALE = "somnus-tool-waveform";
    var STYLE_MARK = "somnus-tool-waveform";
    function injectStyles() {
      if (typeof document === "undefined" || document.head === null) return () => {
      };
      const selector = `style[data-${STYLE_MARK}="styles"]`;
      if (document.head.querySelector(selector) !== null) return () => {
      };
      const style = document.createElement("style");
      style.dataset.somnusToolWaveform = "styles";
      style.textContent = native_tools_default;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }
    function WaveformPage() {
      return /* @__PURE__ */ React.createElement("div", { className: "somnus-native-tools" }, /* @__PURE__ */ React.createElement(NativeWaveform, { active: true }));
    }
    var inject = ["slots"];
    function apply(ctx) {
      ctx.effect(() => injectStyles(), "somnus-tool-waveform: styles");
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        locale: LOCALE
      }, () => /* @__PURE__ */ React.createElement(WaveformPage, null)));
      ctx.inject(["somnusTools"], (scope) => {
        const registry = scope.get("somnusTools");
        if (!registry) return;
        ctx.effect(() => registry.register({
          id: "waveform",
          title: "\u6CE2\u5F62\u5206\u6790",
          hint: "\u6253\u5F00\u6216\u9009\u62E9\u8BB0\u5F55\u540E\u5206\u6790 CSV \u6CE2\u5F62\u548C\u590D\u6838\u4E8B\u4EF6",
          prereq: "files",
          icon: "wave",
          panelKey: PANEL_ID,
          order: 1
        }), "somnus tool card: waveform");
      });
    }

    return module.exports;
  },
});
