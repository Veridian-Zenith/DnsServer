"use strict";
// Minimal TypeScript log viewer — loads /api/logs/download and renders color-coded entries.
function htmlEscape(s) {
    if (s == null)
        return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const LOG_TS_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (UTC|Local|local|utc)\]\s?(.*)$/;
const STACK_LINE_RE = /^\s+at\s+\S+/;
const EXC_RE = /^[A-Z][A-Za-z0-9_.]*(?:\.[A-Z][A-Za-z0-9_]*)*Exception(?:\s|:|$)/;
const WARN_RE = /\b(warn(?:ing)?|retry(?:ing)?|deprecated)\b/i;
const ERR_RE = /\b(error|exception|fatal|unhandled|failed|fail)\b/i;
function parseLogText(text) {
    const lines = text.split(/\r?\n/);
    const entries = [];
    let current = null;
    for (const raw of lines) {
        const line = raw || '';
        const m = LOG_TS_RE.exec(line);
        if (m) {
            if (current) {
                entries.push({
                    timestamp: current.ts,
                    tz: current.tz,
                    message: current.msg,
                    stack: current.stack || undefined,
                    level: classifyText(current.msg, !!current.stack)
                });
            }
            current = { ts: m[1], tz: m[2], msg: m[3] || '', stack: '' };
        }
        else if (current) {
            if (STACK_LINE_RE.test(line)) {
                current.stack += (current.stack ? '\n' : '') + line;
            }
            else {
                current.msg += (current.msg ? '\n' : '') + line;
            }
        }
        else {
            entries.push({ timestamp: '', tz: '', message: line, level: 'info' });
        }
    }
    if (current) {
        entries.push({
            timestamp: current.ts,
            tz: current.tz,
            message: current.msg,
            stack: current.stack || undefined,
            level: classifyText(current.msg, !!current.stack)
        });
    }
    return entries;
}
function classifyText(msg, hasStack) {
    if (hasStack)
        return 'error';
    if (EXC_RE.test(msg))
        return 'error';
    if (ERR_RE.test(msg))
        return 'error';
    if (WARN_RE.test(msg))
        return 'warn';
    return 'info';
}
function render(entries) {
    if (!entries || entries.length === 0) {
        return '<div class="log-empty-state">No entries.</div>';
    }
    const rows = [];
    for (const e of entries) {
        const msgHtml = formatMessage(e);
        const stackHtml = e.stack ? `<pre class="log-stack">${htmlEscape(e.stack)}</pre>` : '';
        rows.push(`<div class="log-entry log-line--${e.level}" data-level="${e.level}">
                <span class="log-ts">${htmlEscape(e.timestamp)} <span class="log-tz">${htmlEscape(e.tz)}</span></span>
                <span class="log-badge log-badge--${e.level}">${e.level}</span>
                <div class="log-msg">${msgHtml}</div>
                ${stackHtml}
            </div>`);
    }
    return `<div class="log-content">${rows.join('')}</div>`;
}
function formatMessage(e) {
    const excMatch = /^([A-Z][A-Za-z0-9_.]*(?:\.[A-Z][A-Za-z0-9_]*)*Exception)(?::\s*(.*))?$/.exec(e.message);
    if (excMatch) {
        return `<span class="log-exc-type">${htmlEscape(excMatch[1])}</span>`
            + (excMatch[2] ? ': ' + htmlEscape(excMatch[2]) : '');
    }
    return htmlEscape(e.message).replace(/\n/g, '<br/>');
}
function applyFilter(el) {
    const input = document.getElementById('txtLogQuickFilter');
    const level = document.getElementById('optLogFilterLevel');
    const query = (input ? input.value : '').toLowerCase().trim();
    const filterLevel = (level ? level.value : 'all');
    const rows = document.querySelectorAll('.log-entry');
    rows.forEach((row) => {
        const levelAttr = row.getAttribute('data-level') || 'info';
        const text = row.textContent || '';
        const levelOk = filterLevel === 'all'
            || (filterLevel === 'info' && levelAttr === 'info')
            || (filterLevel === 'warn' && (levelAttr === 'warn' || levelAttr === 'error'))
            || (filterLevel === 'error' && levelAttr === 'error');
        const searchOk = !query || text.toLowerCase().includes(query);
        row.style.display = (levelOk && searchOk) ? '' : 'none';
    });
}
function loadLog(fileName) {
    const container = document.getElementById('logBody');
    const title = document.getElementById('txtLogViewerTitle');
    if (!container || !title)
        return;
    title.textContent = fileName;
    const rightPane = document.getElementById('divLogViewer');
    if (rightPane)
        rightPane.classList.remove('log-viewer-pane-hidden');
    container.innerHTML = '<div class="log-viewer-loader"><div class="loader-css"></div><div style="margin-top: 12px;">Loading...</div></div>';
    const node = document.getElementById('optLogsClusterNode')?.value || '';
    const url = `/api/logs/download?fileName=${encodeURIComponent(fileName)}&node=${encodeURIComponent(node)}`;
    fetch(url, {
        headers: { 'Authorization': 'Bearer ' + (window.sessionData ? window.sessionData.token : '') }
    })
        .then(r => {
        if (!r.ok)
            throw new Error('Download failed: ' + r.status);
        return r.text();
    })
        .then(text => {
        container.innerHTML = render(parseLogText(text));
        applyFilter({ value: '' });
    })
        .catch(err => {
        container.innerHTML = '<div class="log-empty-state">Failed to download: ' + htmlEscape(err.message) + '</div>';
    });
}
// Auto-refresh when the Logs main tab is activated.
function refreshLogList() {
    const list = document.getElementById('lstLogFiles');
    if (!list)
        return;
    list.innerHTML = '<div class="log-empty-state">Loading...</div>';
    const node = document.getElementById('optLogsClusterNode')?.value || '';
    fetch(`/api/logs/list?node=${encodeURIComponent(node)}`, {
        headers: { 'Authorization': 'Bearer ' + (window.sessionData ? window.sessionData.token : '') }
    })
        .then(r => r.json())
        .then((data) => {
        const files = data?.response?.logFiles || [];
        let html = '';
        if (files.length === 0) {
            html = '<div class="log-empty-state">No log files found</div>';
        }
        else {
            for (const f of files) {
                html += `<div class="log-file-row"><a href="#" onclick="loadLog('${f.fileName.replace(/'/g, "&#39;")}'); return false;">${htmlEscape(f.fileName)}</a><span class="log-file-size">[${htmlEscape(f.size)}]</span></div>`;
            }
        }
        list.innerHTML = html;
    })
        .catch(err => {
        list.innerHTML = '<div class="log-empty-state">Failed to load files</div>';
    });
}
// Initialize.
document.addEventListener('DOMContentLoaded', () => {
    refreshLogList();
    const quickFilter = document.getElementById('txtLogQuickFilter');
    if (quickFilter)
        quickFilter.addEventListener('input', () => applyFilter(quickFilter));
    const levelSelect = document.getElementById('optLogFilterLevel');
    if (levelSelect)
        levelSelect.addEventListener('change', () => applyFilter(quickFilter));
    const btnClear = document.querySelector('.btn-sm');
    if (btnClear && btnClear.textContent && btnClear.textContent.includes('Clear')) {
        btnClear.addEventListener('click', () => {
            quickFilter.value = '';
            levelSelect.value = 'all';
            applyFilter(quickFilter);
        });
    }
});
