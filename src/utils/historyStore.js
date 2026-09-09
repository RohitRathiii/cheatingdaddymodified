const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_PENDING_BYTES = 4 * 1024 * 1024;

/** @typedef {{id?:string,type?:string,timestamp?:number,transcription?:string,ai_response?:string,prompt?:string,response?:string,summary?:string}} HistoryRecord */

function recordText(record) {
    return [record.transcription, record.ai_response, record.prompt, record.response].filter(Boolean).join('\n');
}

function takeTail(text, limit) {
    return text.length <= limit ? text : text.slice(-limit);
}

function buildRelevantContext({ query, summary = '', records = [] }) {
    const terms = new Set(String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const recentRecords = records.slice(-20);
    const recentIds = new Set(recentRecords.map(record => record.id));
    const relevant = records
        .filter(record => !recentIds.has(record.id))
        .map(record => ({ record, score: [...terms].filter(term => recordText(record).toLowerCase().includes(term)).length }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.record);
    const render = list => list.map(record => `[${record.id || 'turn'}]\n${recordText(record)}`).join('\n\n');
    const sections = [
        summary ? `Meeting summary:\n${summary.slice(0, 8000)}` : '',
        relevant.length ? `Relevant earlier details:\n${takeTail(render(relevant), 8000)}` : '',
        recentRecords.length ? `Recent conversation:\n${takeTail(render(recentRecords), 16000)}` : '',
    ].filter(Boolean);
    return sections.join('\n\n').slice(0, 32000);
}

class HistoryStore {
    /** @param {{root:string,maxPendingBytes?:number}} options */
    constructor({ root, maxPendingBytes = MAX_PENDING_BYTES }) {
        this.root = root;
        this.maxPendingBytes = maxPendingBytes;
        this.sessions = new Map();
    }

    jsonlPath(sessionId) {
        return path.join(this.root, `${sessionId}.jsonl`);
    }

    metadataPath(sessionId) {
        return path.join(this.root, `${sessionId}.meta.json`);
    }

    async ensureSession(sessionId) {
        if (this.sessions.has(sessionId)) return this.sessions.get(sessionId);
        await fs.mkdir(this.root, { recursive: true });
        const existing = await this.readRecords(sessionId);
        const state = { ids: new Set(existing.map(record => record.id).filter(Boolean)), pendingBytes: 0, chain: Promise.resolve() };
        this.sessions.set(sessionId, state);
        return state;
    }

    async startSession(metadata) {
        await this.ensureSession(metadata.sessionId);
        const value = { ...metadata, createdAt: metadata.createdAt || Number(metadata.sessionId) || Date.now(), lastUpdated: Date.now(), messageCount: 0 };
        await fs.writeFile(this.metadataPath(metadata.sessionId), JSON.stringify(value));
        return value;
    }

    async append(sessionId, record) {
        const state = await this.ensureSession(sessionId);
        if (record.id && state.ids.has(record.id)) return { duplicate: true };
        const line = `${JSON.stringify(record)}\n`;
        const bytes = Buffer.byteLength(line);
        if (state.pendingBytes + bytes > this.maxPendingBytes) throw new Error('Meeting history write queue is full');
        if (record.id) state.ids.add(record.id);
        state.pendingBytes += bytes;
        state.chain = state.chain.then(async () => {
            try {
                await fs.appendFile(this.jsonlPath(sessionId), line);
                await this.updateMetadata(sessionId, record);
            } finally {
                state.pendingBytes -= bytes;
            }
        });
        await state.chain;
        return { duplicate: false };
    }

    async updateMetadata(sessionId, record) {
        let metadata = { sessionId, createdAt: Number(sessionId) || Date.now(), messageCount: 0, screenAnalysisCount: 0 };
        try {
            metadata = { ...metadata, ...JSON.parse(await fs.readFile(this.metadataPath(sessionId), 'utf8')) };
        } catch {}
        if (record.type === 'turn') metadata.messageCount++;
        if (record.type === 'screen') metadata.screenAnalysisCount++;
        metadata.lastUpdated = Date.now();
        await fs.writeFile(this.metadataPath(sessionId), JSON.stringify(metadata));
    }

    async flush(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state) await state.chain;
    }

    async readRecords(sessionId) {
        try {
            const text = await fs.readFile(this.jsonlPath(sessionId), 'utf8');
            return text
                .split('\n')
                .filter(Boolean)
                .flatMap(line => {
                    try {
                        return [JSON.parse(line)];
                    } catch {
                        return [];
                    }
                });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        try {
            const legacy = JSON.parse(await fs.readFile(path.join(this.root, `${sessionId}.json`), 'utf8'));
            return [
                ...(legacy.conversationHistory || []).map((record, index) => ({ ...record, id: record.id || `legacy-turn-${index}`, type: 'turn' })),
                ...(legacy.screenAnalysisHistory || []).map((record, index) => ({ ...record, id: record.id || `legacy-screen-${index}`, type: 'screen' })),
            ];
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }

    async readPage(sessionId, { cursor = 0, limit = 50 } = {}) {
        const records = await this.readRecords(sessionId);
        const page = records.slice(cursor, cursor + Math.min(50, Math.max(1, limit)));
        return { records: page, nextCursor: cursor + page.length < records.length ? cursor + page.length : null };
    }

    async listSessions() {
        await fs.mkdir(this.root, { recursive: true });
        const files = await fs.readdir(this.root);
        const ids = new Set(files.filter(file => /\.(jsonl|json)$/.test(file) && !file.endsWith('.meta.json')).map(file => file.replace(/\.(jsonl|json)$/, '')));
        return Promise.all(
            [...ids].map(async sessionId => {
                try {
                    return JSON.parse(await fs.readFile(this.metadataPath(sessionId), 'utf8'));
                } catch {
                    const records = await this.readRecords(sessionId);
                    return {
                        sessionId,
                        createdAt: Number(sessionId) || 0,
                        lastUpdated: Number(sessionId) || 0,
                        messageCount: records.filter(record => record.type === 'turn').length,
                        screenAnalysisCount: records.filter(record => record.type === 'screen').length,
                    };
                }
            })
        ).then(sessions => sessions.sort((a, b) => b.lastUpdated - a.lastUpdated));
    }

    async readSession(sessionId) {
        const records = await this.readRecords(sessionId);
        let metadata = { sessionId, createdAt: Number(sessionId) || 0 };
        try {
            metadata = { ...metadata, ...JSON.parse(await fs.readFile(this.metadataPath(sessionId), 'utf8')) };
        } catch {}
        return {
            ...metadata,
            conversationHistory: records.filter(record => record.type === 'turn'),
            screenAnalysisHistory: records.filter(record => record.type === 'screen'),
            summary: records.filter(record => record.type === 'summary').at(-1)?.summary || '',
        };
    }

    async deleteSession(sessionId) {
        await Promise.allSettled([
            fs.unlink(this.jsonlPath(sessionId)),
            fs.unlink(this.metadataPath(sessionId)),
            fs.unlink(path.join(this.root, `${sessionId}.json`)),
        ]);
        this.sessions.delete(sessionId);
    }

    async deleteAll() {
        let files = [];
        try {
            files = await fs.readdir(this.root);
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        await Promise.all(files.filter(file => /\.(jsonl|meta\.json|json)$/.test(file)).map(file => fs.unlink(path.join(this.root, file))));
        this.sessions.clear();
    }
}

module.exports = { HistoryStore, buildRelevantContext };
