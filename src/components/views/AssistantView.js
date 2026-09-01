import { html, css, LitElement } from '../../assets/lit-core-2.7.4.min.js';

export class AssistantView extends LitElement {
    static styles = css`
        :host {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        * {
            font-family: var(--font);
            cursor: default;
        }

        /* ── Response area ── */

        .transcript-wrap {
            position: relative;
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        .response-container {
            flex: 1;
            overflow-y: auto;
            font-size: var(--response-font-size, 15px);
            line-height: var(--line-height);
            background: var(--bg-app);
            padding: var(--space-sm) var(--space-md);
            scroll-behavior: auto;
            user-select: text;
            cursor: text;
            color: var(--text-primary);
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
        }

        .answer-card {
            flex-shrink: 0;
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            background: var(--bg-surface);
            padding: var(--space-sm) var(--space-md);
        }

        .answer-card.focused {
            border-color: var(--border-strong);
        }

        .answer-label {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            font-family: var(--font-mono);
            margin-bottom: var(--space-xs);
            user-select: none;
            cursor: default;
        }

        .placeholder {
            color: var(--text-primary);
            padding: var(--space-sm) 0;
        }

        .jump-latest {
            position: absolute;
            right: var(--space-md);
            bottom: var(--space-md);
            z-index: 2;
            border: 1px solid var(--border);
            background: var(--bg-elevated);
            color: var(--text-primary);
            border-radius: 100px;
            padding: var(--space-xs) var(--space-md);
            font-size: var(--font-size-xs);
            font-family: var(--font);
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        }

        .jump-latest:hover {
            border-color: var(--accent);
        }

        .jump-latest[hidden] {
            display: none;
        }

        .response-container * {
            user-select: text;
            cursor: text;
        }

        .response-container a {
            cursor: pointer;
        }

        .response-container [data-word] {
            display: inline-block;
        }

        /* ── Markdown ── */

        .response-container h1,
        .response-container h2,
        .response-container h3,
        .response-container h4,
        .response-container h5,
        .response-container h6 {
            margin: 1em 0 0.5em 0;
            color: var(--text-primary);
            font-weight: var(--font-weight-semibold);
        }

        .response-container h1 {
            font-size: 1.5em;
        }
        .response-container h2 {
            font-size: 1.3em;
        }
        .response-container h3 {
            font-size: 1.15em;
        }
        .response-container h4 {
            font-size: 1.05em;
        }
        .response-container h5,
        .response-container h6 {
            font-size: 1em;
        }

        .response-container p {
            margin: 0.6em 0;
            color: var(--text-primary);
        }

        .response-container ul,
        .response-container ol {
            margin: 0.6em 0;
            padding-left: 1.5em;
            color: var(--text-primary);
        }

        .response-container li {
            margin: 0.3em 0;
        }

        .response-container blockquote {
            margin: 0.8em 0;
            padding: 0.5em 1em;
            border-left: 2px solid var(--border-strong);
            background: var(--bg-surface);
            border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        }

        .response-container code {
            background: var(--bg-elevated);
            padding: 0.15em 0.4em;
            border-radius: var(--radius-sm);
            font-family: var(--font-mono);
            font-size: 0.85em;
        }

        .response-container pre {
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: var(--space-md);
            overflow-x: auto;
            margin: 0.8em 0;
        }

        .response-container pre code {
            background: none;
            padding: 0;
        }

        .response-container a {
            color: var(--accent);
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .response-container strong,
        .response-container b {
            font-weight: var(--font-weight-semibold);
        }

        .response-container hr {
            border: none;
            border-top: 1px solid var(--border);
            margin: 1.5em 0;
        }

        .response-container table {
            border-collapse: collapse;
            width: 100%;
            margin: 0.8em 0;
        }

        .response-container th,
        .response-container td {
            border: 1px solid var(--border);
            padding: var(--space-sm);
            text-align: left;
        }

        .response-container th {
            background: var(--bg-surface);
            font-weight: var(--font-weight-semibold);
        }

        .response-container::-webkit-scrollbar {
            width: 6px;
        }

        .response-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .response-container::-webkit-scrollbar-thumb {
            background: var(--border-strong);
            border-radius: 3px;
        }

        .response-container::-webkit-scrollbar-thumb:hover {
            background: #444444;
        }

        /* ── Bottom input bar ── */

        .input-bar {
            display: flex;
            align-items: center;
            gap: var(--space-sm);
            padding: var(--space-md);
            background: var(--bg-app);
        }

        .input-bar-inner {
            display: flex;
            align-items: center;
            flex: 1;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            border-radius: 100px;
            padding: 0 var(--space-md);
            height: 32px;
            transition: border-color var(--transition);
        }

        .input-bar-inner:focus-within {
            border-color: var(--accent);
        }

        .input-bar-inner input {
            flex: 1;
            background: none;
            color: var(--text-primary);
            border: none;
            padding: 0;
            font-size: var(--font-size-sm);
            font-family: var(--font);
            height: 100%;
            outline: none;
        }

        .input-bar-inner input::placeholder {
            color: var(--text-muted);
        }

        .analyze-btn {
            position: relative;
            background: var(--bg-elevated);
            border: 1px solid var(--border);
            color: var(--text-primary);
            cursor: pointer;
            font-size: var(--font-size-xs);
            font-family: var(--font-mono);
            white-space: nowrap;
            padding: var(--space-xs) var(--space-md);
            border-radius: 100px;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition:
                border-color 0.4s ease,
                background var(--transition);
            flex-shrink: 0;
            overflow: hidden;
        }

        .analyze-btn:hover:not(.analyzing) {
            border-color: var(--accent);
            background: var(--bg-surface);
        }

        .analyze-btn.analyzing {
            cursor: default;
            border-color: transparent;
        }

        .analyze-btn-content {
            display: flex;
            align-items: center;
            gap: 4px;
            transition: opacity 0.4s ease;
            z-index: 1;
            position: relative;
        }

        .analyze-btn.analyzing .analyze-btn-content {
            opacity: 0;
        }

        .analyze-canvas {
            position: absolute;
            inset: -1px;
            width: calc(100% + 2px);
            height: calc(100% + 2px);
            pointer-events: none;
        }
    `;

    static properties = {
        responses: { type: Array },
        currentResponseIndex: { type: Number },
        selectedProfile: { type: String },
        onSendText: { type: Function },
        shouldAnimateResponse: { type: Boolean },
        isAnalyzing: { type: Boolean, state: true },
        _showJumpToLatest: { type: Boolean, state: true },
    };

    constructor() {
        super();
        this.responses = [];
        this.currentResponseIndex = -1;
        this.selectedProfile = 'interview';
        this.onSendText = () => {};
        this.isAnalyzing = false;
        this._animFrame = null;
        this._showJumpToLatest = false;
        this._cardCount = 0;
        this._latestObserver = null;
        this._analyzeTimeout = null;
    }

    getProfileNames() {
        return {
            interview: 'Job Interview',
            lld: 'LLD Interview (SDE-2)',
            sales: 'Sales Call',
            meeting: 'Business Meeting',
            presentation: 'Presentation',
            negotiation: 'Negotiation',
            exam: 'Exam Assistant',
        };
    }

    getPlaceholderText() {
        const profileNames = this.getProfileNames();
        return `Listening to your ${profileNames[this.selectedProfile] || 'session'}...`;
    }

    renderMarkdown(content) {
        if (typeof window !== 'undefined' && window.marked) {
            try {
                window.marked.setOptions({
                    breaks: true,
                    gfm: true,
                    sanitize: false,
                });
                let rendered = window.marked.parse(content);
                rendered = this.wrapWordsInSpans(rendered);
                return rendered;
            } catch (error) {
                console.warn('Error parsing markdown:', error);
                return content;
            }
        }
        return content;
    }

    wrapWordsInSpans(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const tagsToSkip = ['PRE'];

        function wrap(node) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !tagsToSkip.includes(node.parentNode.tagName)) {
                const words = node.textContent.split(/(\s+)/);
                const frag = document.createDocumentFragment();
                words.forEach(word => {
                    if (word.trim()) {
                        const span = document.createElement('span');
                        span.setAttribute('data-word', '');
                        span.textContent = word;
                        frag.appendChild(span);
                    } else {
                        frag.appendChild(document.createTextNode(word));
                    }
                });
                node.parentNode.replaceChild(frag, node);
            } else if (node.nodeType === Node.ELEMENT_NODE && !tagsToSkip.includes(node.tagName)) {
                Array.from(node.childNodes).forEach(wrap);
            }
        }
        Array.from(doc.body.childNodes).forEach(wrap);
        return doc.body.innerHTML;
    }

    _emitFocusedIndex(index) {
        this.currentResponseIndex = index;
        this.dispatchEvent(
            new CustomEvent('response-index-changed', {
                detail: { index: this.currentResponseIndex },
            })
        );
        this._updateFocusedCard();
        this.requestUpdate();
    }

    navigateToPreviousResponse() {
        if (this.responses.length === 0) return;
        const nextIndex = this.currentResponseIndex > 0 ? this.currentResponseIndex - 1 : this.currentResponseIndex === -1 ? 0 : -1;
        if (nextIndex < 0) return;
        this._emitFocusedIndex(nextIndex);
        this._scrollCardIntoView(nextIndex);
    }

    navigateToNextResponse() {
        if (this.responses.length === 0) return;
        if (this.currentResponseIndex >= this.responses.length - 1) return;
        const nextIndex = this.currentResponseIndex < 0 ? 0 : this.currentResponseIndex + 1;
        this._emitFocusedIndex(nextIndex);
        this._scrollCardIntoView(nextIndex);
    }

    _scrollCardIntoView(index) {
        const card = this.shadowRoot?.querySelector(`[data-answer-index="${index}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    jumpToLatest() {
        if (this.responses.length === 0) return;
        const lastIndex = this.responses.length - 1;
        this._emitFocusedIndex(lastIndex);
        this._scrollCardIntoView(lastIndex);
    }

    scrollResponseUp() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
        }
    }

    scrollResponseDown() {
        const container = this.shadowRoot.querySelector('.response-container');
        if (container) {
            const scrollAmount = container.clientHeight * 0.3;
            container.scrollTop = Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + scrollAmount);
        }
    }

    connectedCallback() {
        super.connectedCallback();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            this.handlePreviousResponse = () => this.navigateToPreviousResponse();
            this.handleNextResponse = () => this.navigateToNextResponse();
            this.handleScrollUp = () => this.scrollResponseUp();
            this.handleScrollDown = () => this.scrollResponseDown();

            ipcRenderer.on('navigate-previous-response', this.handlePreviousResponse);
            ipcRenderer.on('navigate-next-response', this.handleNextResponse);
            ipcRenderer.on('scroll-response-up', this.handleScrollUp);
            ipcRenderer.on('scroll-response-down', this.handleScrollDown);
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this._stopWaveformAnimation();
        this._disconnectLatestObserver();
        if (this._analyzeTimeout) {
            clearTimeout(this._analyzeTimeout);
            this._analyzeTimeout = null;
        }

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            if (this.handlePreviousResponse) ipcRenderer.removeListener('navigate-previous-response', this.handlePreviousResponse);
            if (this.handleNextResponse) ipcRenderer.removeListener('navigate-next-response', this.handleNextResponse);
            if (this.handleScrollUp) ipcRenderer.removeListener('scroll-response-up', this.handleScrollUp);
            if (this.handleScrollDown) ipcRenderer.removeListener('scroll-response-down', this.handleScrollDown);
        }
    }

    async handleSendText() {
        const textInput = this.shadowRoot.querySelector('#textInput');
        if (textInput && textInput.value.trim()) {
            const message = textInput.value.trim();
            textInput.value = '';
            await this.onSendText(message);
        }
    }

    handleTextKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendText();
        }
    }

    async handleScreenAnswer() {
        if (this.isAnalyzing) return;
        if (!window.captureManualScreenshot) {
            return;
        }
        this.isAnalyzing = true;
        this._responseCountWhenStarted = this.responses.length;
        if (this._analyzeTimeout) {
            clearTimeout(this._analyzeTimeout);
        }
        try {
            const result = await window.captureManualScreenshot();
            if (!result?.success) {
                this.isAnalyzing = false;
                return;
            }
            this._analyzeTimeout = setTimeout(() => {
                this.isAnalyzing = false;
                this._analyzeTimeout = null;
            }, 20000);
        } catch (error) {
            console.error('Analyze Screen failed:', error);
            this.isAnalyzing = false;
        }
    }

    _startWaveformAnimation() {
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const dangerColor = getComputedStyle(this).getPropertyValue('--danger').trim() || '#EF4444';
        const startTime = performance.now();
        const FADE_IN = 0.5; // seconds
        const PARTICLE_SPREAD = 4; // px inward from border
        const PARTICLE_COUNT = 250;

        // Pill perimeter helpers
        const w = rect.width;
        const h = rect.height;
        const r = h / 2; // pill radius = half height
        const straightLen = w - 2 * r;
        const arcLen = Math.PI * r;
        const perimeter = 2 * straightLen + 2 * arcLen;

        // Given a distance along the perimeter, return {x, y, nx, ny} (position + inward normal)
        const pointOnPerimeter = d => {
            d = ((d % perimeter) + perimeter) % perimeter;
            // Top straight: left to right
            if (d < straightLen) {
                return { x: r + d, y: 0, nx: 0, ny: 1 };
            }
            d -= straightLen;
            // Right arc
            if (d < arcLen) {
                const angle = -Math.PI / 2 + (d / arcLen) * Math.PI;
                return {
                    x: w - r + Math.cos(angle) * r,
                    y: r + Math.sin(angle) * r,
                    nx: -Math.cos(angle),
                    ny: -Math.sin(angle),
                };
            }
            d -= arcLen;
            // Bottom straight: right to left
            if (d < straightLen) {
                return { x: w - r - d, y: h, nx: 0, ny: -1 };
            }
            d -= straightLen;
            // Left arc
            const angle = Math.PI / 2 + (d / arcLen) * Math.PI;
            return {
                x: r + Math.cos(angle) * r,
                y: r + Math.sin(angle) * r,
                nx: -Math.cos(angle),
                ny: -Math.sin(angle),
            };
        };

        // Pre-seed random offsets for stable particles
        const seeds = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            seeds.push({ pos: Math.random(), drift: Math.random(), depthSeed: Math.random() });
        }

        const draw = now => {
            const elapsed = (now - startTime) / 1000;
            const fade = Math.min(1, elapsed / FADE_IN);

            ctx.clearRect(0, 0, w, h);

            // ── Particle border ──
            ctx.fillStyle = dangerColor;
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const s = seeds[i];
                const along = (s.pos + s.drift * elapsed * 0.03) * perimeter;
                const depth = s.depthSeed * PARTICLE_SPREAD;
                const density = 1 - depth / PARTICLE_SPREAD;

                if (Math.random() > density) continue;

                const p = pointOnPerimeter(along);
                const px = p.x + p.nx * depth;
                const py = p.y + p.ny * depth;
                const size = 0.8 + density * 0.6;

                ctx.globalAlpha = fade * density * 0.85;
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fill();
            }

            // ── Waveform ──
            const midY = h / 2;
            const waves = [
                { freq: 3, amp: 0.35, speed: 2.5, opacity: 0.9, width: 1.8 },
                { freq: 5, amp: 0.2, speed: 3.5, opacity: 0.5, width: 1.2 },
                { freq: 7, amp: 0.12, speed: 5, opacity: 0.3, width: 0.8 },
            ];

            for (const wave of waves) {
                ctx.beginPath();
                ctx.strokeStyle = dangerColor;
                ctx.globalAlpha = wave.opacity * fade;
                ctx.lineWidth = wave.width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                for (let x = 0; x <= w; x++) {
                    const norm = x / w;
                    const envelope = Math.sin(norm * Math.PI);
                    const y = midY + Math.sin(norm * Math.PI * 2 * wave.freq + elapsed * wave.speed) * (midY * wave.amp) * envelope;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            ctx.globalAlpha = 1;
            this._animFrame = requestAnimationFrame(draw);
        };

        this._animFrame = requestAnimationFrame(draw);
    }

    _stopWaveformAnimation() {
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        const canvas = this.shadowRoot.querySelector('.analyze-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    firstUpdated() {
        super.firstUpdated();
        this._syncTranscript();
    }

    updated(changedProperties) {
        super.updated(changedProperties);
        if (changedProperties.has('responses')) {
            this._syncTranscript();
        } else if (changedProperties.has('currentResponseIndex')) {
            this._updateFocusedCard();
        }

        if (changedProperties.has('selectedProfile') && this.responses.length === 0) {
            this._syncTranscript();
        }

        if (changedProperties.has('isAnalyzing')) {
            if (this.isAnalyzing) {
                this._startWaveformAnimation();
            } else {
                this._stopWaveformAnimation();
            }
        }

        if (changedProperties.has('responses') && this.isAnalyzing) {
            if (this.responses.length > this._responseCountWhenStarted) {
                this.isAnalyzing = false;
                if (this._analyzeTimeout) {
                    clearTimeout(this._analyzeTimeout);
                    this._analyzeTimeout = null;
                }
            }
        }
    }

    _getContainer() {
        return this.shadowRoot?.querySelector('#responseContainer');
    }

    _createCard(index) {
        const card = document.createElement('article');
        card.className = 'answer-card';
        card.dataset.answerIndex = String(index);

        const label = document.createElement('div');
        label.className = 'answer-label';
        label.textContent = `Answer ${index + 1}`;

        const body = document.createElement('div');
        body.className = 'answer-body';

        card.appendChild(label);
        card.appendChild(body);
        return card;
    }

    _setCardBody(card, content) {
        const body = card.querySelector('.answer-body');
        if (!body) return;
        if (card.dataset.content === content) return;
        body.innerHTML = this.renderMarkdown(content);
        card.dataset.content = content;
    }

    _updateFocusedCard() {
        const container = this._getContainer();
        if (!container) return;
        container.querySelectorAll('.answer-card').forEach(card => {
            const index = Number(card.dataset.answerIndex);
            card.classList.toggle('focused', index === this.currentResponseIndex);
        });
    }

    _disconnectLatestObserver() {
        if (this._latestObserver) {
            this._latestObserver.disconnect();
            this._latestObserver = null;
        }
    }

    _observeLatest() {
        this._disconnectLatestObserver();
        const container = this._getContainer();
        if (!container || this.responses.length === 0) {
            this._showJumpToLatest = false;
            return;
        }

        const lastCard = container.querySelector(`[data-answer-index="${this.responses.length - 1}"]`);
        if (!lastCard) {
            this._showJumpToLatest = false;
            return;
        }

        this._latestObserver = new IntersectionObserver(
            entries => {
                const entry = entries[0];
                this._showJumpToLatest = !entry.isIntersecting || entry.intersectionRatio < 0.9;
            },
            { root: container, threshold: [0, 0.9, 1] }
        );
        this._latestObserver.observe(lastCard);
    }

    _syncTranscript() {
        const container = this._getContainer();
        if (!container) return;

        const scrollTop = container.scrollTop;

        if (this.responses.length === 0) {
            this._disconnectLatestObserver();
            container.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'placeholder';
            placeholder.textContent = this.getPlaceholderText();
            container.appendChild(placeholder);
            this._cardCount = 0;
            this._showJumpToLatest = false;
            container.scrollTop = scrollTop;
            return;
        }

        if (this._cardCount === 0 || container.querySelector('.placeholder')) {
            container.innerHTML = '';
            this._cardCount = 0;
        }

        const previousCount = this._cardCount;
        while (this._cardCount < this.responses.length) {
            const card = this._createCard(this._cardCount);
            container.appendChild(card);
            this._setCardBody(card, this.responses[this._cardCount]);
            this._cardCount++;
        }

        const lastIndex = this.responses.length - 1;
        const lastCard = container.querySelector(`[data-answer-index="${lastIndex}"]`);
        if (lastCard) {
            this._setCardBody(lastCard, this.responses[lastIndex]);
        }

        this._updateFocusedCard();
        container.scrollTop = scrollTop;
        if (previousCount !== this._cardCount || !this._latestObserver) {
            this._observeLatest();
        }

        if (this.shouldAnimateResponse) {
            this.dispatchEvent(new CustomEvent('response-animation-complete', { bubbles: true, composed: true }));
        }
    }

    render() {
        return html`
            <div class="transcript-wrap">
                <div class="response-container" id="responseContainer"></div>
                <button class="jump-latest" ?hidden=${!this._showJumpToLatest} @click=${() => this.jumpToLatest()} type="button">
                    Jump to latest
                </button>
            </div>

            <div class="input-bar">
                <div class="input-bar-inner">
                    <input type="text" id="textInput" placeholder="Type a message..." @keydown=${this.handleTextKeydown} />
                </div>
                <button class="analyze-btn ${this.isAnalyzing ? 'analyzing' : ''}" @click=${this.handleScreenAnswer}>
                    <canvas class="analyze-canvas"></canvas>
                    <span class="analyze-btn-content">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24">
                            <path
                                fill="none"
                                stroke="currentColor"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M13 3v7h6l-8 11v-7H5z"
                            />
                        </svg>
                        Analyze Screen
                    </span>
                </button>
            </div>
        `;
    }
}

customElements.define('assistant-view', AssistantView);
