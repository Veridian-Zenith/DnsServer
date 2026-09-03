// Minimal TypeScript log viewer frontend for Technitium DNS Server.
// Reads /api/logs/download and /api/logs/list; displays parsed log entries.

interface LogEntry {
    timestamp: string;
    tz: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    stack?: string;
}

function htmlEscape(s: string | null | undefined): string {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function parseLogText(text: string): LogEntry[] {
    const lines = text.split(/\r?\n/);
    const entries: LogEntry[] = [];
    let current: { timestamp: string; tz: string; message: string; stack: string } | null = null;

    const TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (UTC|Local|local|utc)\]\s?(.*)$/;
    const STACK_FRAME_RE = /^\s+at\s+\S+/;
    const EXC_RE = /^[A-Z][A-Za-z0-9_.]*(?:\.[A-Z][A-Za-z0-9_]*)*Exception(?:\s|:|$)/;
    const WARN_RE = /\b(warn(?:ing)?|retry(?:ing)?|deprecated)\b/i;
    const ERR_RE  = /\b(error|exception|fatal|unhandled|failed|fail)\b/i;

    for (const rawLine of lines) {
        const line = rawLine || '';
        const m = TIMESTAMP_RE.exec(line);
        if (m) {
            if (current) {
                entries.push({
                    timestamp: current.timestamp,
                    tz: current.tz,
                    message: current.message,
                    stack: current.stack || undefined,
                    level: classifyLevel(current.message, !!current.stack)
                } as LogEntry);
            }
            current = {
                timestamp: m[1],
                tz: m[2],
                message: m[3] || '',
                stack: ''
            };
        } else if (current) {
            if (STACK_FRAME_RE.test(line)) {
                current.stack += (current.stack ? '\n' : '') + line;
            } else {
                current.message += (current.message ? '\n' : '') + line;
            }
        } else {
            // Pre-timestamp lines
            entries.push({
                timestamp: '',
                tz: '',
                message: line,
                stack: '',
                level: 'info'
            } as LogEntry);
        }
    }
    if (current) {
        entries.push({
            timestamp: current.timestamp,
            tz: current.tz,
            message: current.message,
            stack: current.stack || undefined,
            level: classifyLevel(current.message, !!current.stack)
        } as LogEntry);
    }
    return entries;
}

function classifyLevel(msg: string, hasStack: boolean): 'info' | 'warn' | 'error' {
    if (hasStack) return 'error';
    if (EXC_RE.test(msg)) return 'error';
    if (ERR_RE.test(msg)) return 'error';
    if (WARN_RE.test(msg)) return 'warn';
    return 'info';
}

function render(entries: LogEntry[]): string {
    if (!entries || entries.length === 0) {
        return '<div class="log-empty-state">No log entries.</div>';
    }
    let htmlOut = '<div class="log-content">';
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const stack = e.stack ? `<pre class="log-stack">${htmlEscape(e.stack)}</pre>` : '';
        htmlOut += `<div class="log-entry log-line--${e.level}">
            <span class="log-ts">${htmlEscape(e.timestamp)} <span class="log-tz">${htmlEscape(e.tz)}</span></span>
            <span class="log-badge log-badge--${e.level}">${e.level}</span>
            <div class="log-msg">${e.stack ? formatException(e.message) : htmlEscape(e.message).replace(/\n/g, '<br/>')}</div>
            ${stack}
        </div>`;
    }
    htmlOut += '</div>';
    return htmlOut;
}

function formatException(msg: string): string {
    const exc = /^([A-Z][A-Za-z0-9_.]*(?:\.[A-Z][A-Za-z0-9_]*)*Exception)(?::\s*(.*))?$/.exec(msg);
    if (exc) {
        return `<span class="log-exc-type">${htmlEscape(exc[1])}</span>`
            + (exc[2] ? ': ' + htmlEscape(exc[2]) : '');
    }
    return htmlEscape(msg).replace(/\n/g, '<br/>');
}

export { parseLogText, render, LogEntry, htmlEscape, classifyLevel, formatException };
