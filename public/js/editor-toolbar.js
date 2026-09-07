const EditorToolbar = (() => {
    // Icons: Lucide (ISC). One stroke-based set so every button reads the same.
    const icon = (inner) =>
        `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon-stroke">${inner}</svg>`;

    const ICONS = {
        ul: icon('<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13"/>'),
        ol: icon('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
        left: icon('<path d="M21 6H3M15 12H3M17 18H3"/>'),
        center: icon('<path d="M21 6H3M17 12H7M19 18H5"/>'),
        right: icon('<path d="M21 6H3M21 12H9M21 18H7"/>'),
        justify: icon('<path d="M21 6H3M21 12H3M21 18H3"/>'),
        smaller: icon('<path d="M3.5 13h6M2 16l4.5-9L11 16M18 7v9M14 12l4 4 4-4"/>'),
        larger: icon('<path d="M3.5 13h6M2 16l4.5-9L11 16M18 16V7M14 11l4-4 4 4"/>'),
        color: icon('<path d="M4 20h16M6 16l6-12 6 12M8.5 12h7"/>'),
        highlight: icon('<path d="M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
        bookmark: icon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
        clear: icon('<path d="M4 7V4h16v3M5 20h6M13 4L8 20M15 15l5 5M20 15l-5 5"/>'),
        find: icon('<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>'),
        undo: icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
        redo: icon('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
        mirror: icon('<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 2v2M12 8v2M12 14v2M12 20v2"/>'),
        prev: icon('<path d="M18 15l-6-6-6 6"/>'),
        next: icon('<path d="M6 9l6 6 6-6"/>'),
        close: icon('<path d="M18 6L6 18M6 6l12 12"/>')
    };

    const GROUPS = [
        [
            { cmd: 'bold', title: 'Bold (Ctrl+B)', label: 'B', mark: 'bold', toggle: true },
            { cmd: 'italic', title: 'Italic (Ctrl+I)', label: 'I', mark: 'italic', toggle: true },
            { cmd: 'underline', title: 'Underline (Ctrl+U)', label: 'U', mark: 'underline', toggle: true },
            { cmd: 'strikeThrough', title: 'Strikethrough', label: 'S', mark: 'strike', toggle: true }
        ],
        [
            { cmd: 'insertUnorderedList', title: 'Bullet list', icon: ICONS.ul, toggle: true },
            { cmd: 'insertOrderedList', title: 'Numbered list', icon: ICONS.ol, toggle: true }
        ],
        [
            { cmd: 'justifyLeft', title: 'Align left', icon: ICONS.left, toggle: true },
            { cmd: 'justifyCenter', title: 'Align center', icon: ICONS.center, toggle: true },
            { cmd: 'justifyRight', title: 'Align right', icon: ICONS.right, toggle: true },
            { cmd: 'justifyFull', title: 'Justify', icon: ICONS.justify, toggle: true }
        ],
        [
            { cmd: 'smaller', title: 'Smaller text', icon: ICONS.smaller },
            { cmd: 'larger', title: 'Larger text', icon: ICONS.larger }
        ],
        [
            { cmd: 'foreColor', title: 'Text color', icon: ICONS.color, color: true },
            { cmd: 'hiliteColor', title: 'Highlight', icon: ICONS.highlight, color: true }
        ],
        [
            { cmd: 'bookmark', title: 'Insert cue', icon: ICONS.bookmark },
            { cmd: 'removeFormat', title: 'Clear formatting', icon: ICONS.clear },
            { cmd: 'find', title: 'Find (Ctrl+F)', icon: ICONS.find, toggle: true },
            { cmd: 'undo', title: 'Undo (Ctrl+Z)', icon: ICONS.undo },
            { cmd: 'redo', title: 'Redo (Ctrl+Y)', icon: ICONS.redo },
            { cmd: 'mirror', title: 'Mirror editor', icon: ICONS.mirror, toggle: true }
        ]
    ];

    const MIN_FONT_SIZE = 12;
    const MAX_FONT_SIZE = 160;

    const TOGGLE_CMDS = new Set([
        'bold', 'italic', 'underline', 'strikeThrough',
        'insertUnorderedList', 'insertOrderedList',
        'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'
    ]);

    class EditorToolbar {
        constructor({ editor, toolbar, findBar, onChange, onFontSize }) {
            this.editor = editor;
            this.toolbar = toolbar;
            this.findBar = findBar;
            this.onChange = onChange || (() => {});
            this.onFontSize = onFontSize || (() => {});
            this.enabled = true;
            this.matches = [];
            this.matchIndex = -1;
            this.findQuery = '';
            this.render();
            this.bind();
            this.syncBookmarkCount();
        }

        render() {
            this.toolbar.replaceChildren();
            this.toolbar.setAttribute('role', 'toolbar');
            this.toolbar.setAttribute('aria-label', 'Text formatting');

            for (const group of GROUPS) {
                const wrap = document.createElement('div');
                wrap.className = 'toolbar-group';
                for (const item of group) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'toolbar-btn';
                    btn.dataset.cmd = item.cmd;
                    btn.title = item.title;
                    btn.setAttribute('aria-label', item.title);
                    if (item.toggle) btn.setAttribute('aria-pressed', 'false');
                    if (item.label) {
                        btn.classList.add('toolbar-btn-text');
                        if (item.mark) btn.classList.add(`is-${item.mark}`);
                        btn.textContent = item.label;
                    } else {
                        btn.innerHTML = item.icon;
                    }
                    if (item.color) {
                        const input = document.createElement('input');
                        input.type = 'color';
                        input.className = 'toolbar-color';
                        input.dataset.colorCmd = item.cmd;
                        input.value = item.cmd === 'hiliteColor' ? '#f5c518' : '#ffffff';
                        input.tabIndex = -1;
                        btn.appendChild(input);
                    }
                    wrap.appendChild(btn);
                }
                this.toolbar.appendChild(wrap);
            }

            this.findBar.className = 'editor-find';
            this.findBar.hidden = true;
            this.findBar.innerHTML = `
                <input type="search" class="editor-find-input" placeholder="Find in script…" autocomplete="off">
                <span class="editor-find-count">0/0</span>
                <button type="button" class="toolbar-btn" data-find="prev" title="Previous match" aria-label="Previous match">${ICONS.prev}</button>
                <button type="button" class="toolbar-btn" data-find="next" title="Next match" aria-label="Next match">${ICONS.next}</button>
                <button type="button" class="toolbar-btn" data-find="close" title="Close find" aria-label="Close find">${ICONS.close}</button>
            `;
            this.findInput = this.findBar.querySelector('.editor-find-input');
            this.findCount = this.findBar.querySelector('.editor-find-count');
        }

        bind() {
            this.toolbar.addEventListener('mousedown', (e) => {
                this.saveSelection();
                if (e.target.closest('input[type="color"]')) return;
                if (e.target.closest('button')) e.preventDefault();
            });

            this.toolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-cmd]');
                if (!btn || !this.enabled) return;
                if (e.target.closest('input[type="color"]')) return;
                this.run(btn.dataset.cmd, btn);
            });

            this.toolbar.addEventListener('input', (e) => {
                const input = e.target.closest('input[type="color"]');
                if (!input || !this.enabled) return;
                this.exec(input.dataset.colorCmd, input.value);
            });

            this.findBar.addEventListener('mousedown', (e) => {
                if (e.target.closest('button')) e.preventDefault();
            });

            this.findBar.addEventListener('click', (e) => {
                const action = e.target.closest('[data-find]')?.dataset.find;
                if (action === 'prev') this.jump(-1);
                if (action === 'next') this.jump(1);
                if (action === 'close') this.closeFind();
            });

            this.findInput.addEventListener('input', () => this.search(this.findInput.value));
            this.findInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.jump(e.shiftKey ? -1 : 1);
                }
                if (e.key === 'Escape') this.closeFind();
            });

            this.editor.addEventListener('input', () => {
                if (this.findQuery) this.search(this.findQuery);
            });

            this.editor.addEventListener('keydown', (e) => this.handleKeys(e));

            document.addEventListener('selectionchange', () => {
                if (!this.editor.contains(document.getSelection()?.anchorNode)) return;
                this.syncActive();
            });
        }

        handleKeys(e) {
            if (!this.enabled) return;
            const key = e.key.toLowerCase();
            if ((e.ctrlKey || e.metaKey) && key === 'f') {
                e.preventDefault();
                this.openFind();
            }
            if ((e.ctrlKey || e.metaKey) && key === 'b') {
                e.preventDefault();
                this.exec('bold');
            }
            if ((e.ctrlKey || e.metaKey) && key === 'i') {
                e.preventDefault();
                this.exec('italic');
            }
            if ((e.ctrlKey || e.metaKey) && key === 'u') {
                e.preventDefault();
                this.exec('underline');
            }
        }

        run(cmd, btn) {
            if (cmd === 'find') {
                this.findBar.hidden ? this.openFind() : this.closeFind();
                return;
            }
            if (cmd === 'mirror') {
                this.editor.classList.toggle('is-mirrored');
                btn.classList.toggle('is-active', this.editor.classList.contains('is-mirrored'));
                btn.setAttribute('aria-pressed', String(this.editor.classList.contains('is-mirrored')));
                return;
            }
            if (cmd === 'bookmark') {
                this.insertBookmark();
                return;
            }
            if (cmd === 'smaller') {
                this.adjustFontSize(-2);
                return;
            }
            if (cmd === 'larger') {
                this.adjustFontSize(2);
                return;
            }
            this.exec(cmd);
        }

        saveSelection() {
            const sel = window.getSelection();
            if (sel?.rangeCount && this.editor.contains(sel.anchorNode)) {
                this.savedRange = sel.getRangeAt(0).cloneRange();
            }
        }

        focusEditor() {
            const sel = window.getSelection();
            const inside = sel?.rangeCount && this.editor.contains(sel.anchorNode);
            if (!inside && this.savedRange) {
                sel.removeAllRanges();
                sel.addRange(this.savedRange);
            }
            this.editor.focus();
        }

        exec(command, value = null) {
            this.focusEditor();
            document.execCommand('styleWithCSS', false, true);
            document.execCommand(command, false, value);
            this.syncActive();
            this.onChange();
        }

        adjustFontSize(delta) {
            const current = parseFloat(this.editor.style.fontSize) || parseFloat(window.getComputedStyle(this.editor).fontSize) || 16;
            const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(current + delta)));
            this.editor.style.fontSize = `${next}px`;
            this.onFontSize(next);
            this.onChange();
        }

        insertBookmark() {
            this.syncBookmarkCount();
            const n = this.bookmarkCount + 1;
            const name = (window.prompt('Cue name', '') || '').trim();
            const safeName = name.replace(/[<>&"]/g, '');
            const labelAttr = safeName ? ` data-label="${safeName}"` : '';
            const visible = safeName ? `[${n}] ${safeName}` : `[${n}]`;
            this.focusEditor();
            window.getSelection()?.collapseToStart();
            document.execCommand(
                'insertHTML',
                false,
                `<span class="script-bookmark" data-mark="${n}"${labelAttr} contenteditable="false">${visible}</span>&nbsp;`
            );
            this.bookmarkCount = n;
            this.onChange();
        }

        syncBookmarkCount() {
            const marks = [...this.editor.querySelectorAll('.script-bookmark[data-mark]')]
                .map((el) => Number(el.dataset.mark) || 0);
            this.bookmarkCount = marks.length ? Math.max(...marks) : 0;
        }

        openFind() {
            this.findBar.hidden = false;
            this.findInput.focus();
            this.findInput.select();
            this.setFindActive(true);
            if (this.findInput.value) this.search(this.findInput.value);
        }

        closeFind() {
            this.findBar.hidden = true;
            this.clearHighlights();
            this.setFindActive(false);
            this.editor.focus();
        }

        setFindActive(active) {
            const btn = this.toolbar.querySelector('[data-cmd="find"]');
            btn?.classList.toggle('is-active', active);
            btn?.setAttribute('aria-pressed', String(active));
        }

        search(query) {
            this.findQuery = query;
            this.clearHighlights();
            const q = query.trim();
            if (!q) {
                this.findCount.textContent = '0/0';
                return;
            }

            const ranges = [];
            const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const text = node.textContent;
                const lower = text.toLowerCase();
                const needle = q.toLowerCase();
                let from = 0;
                let idx;
                while ((idx = lower.indexOf(needle, from)) !== -1) {
                    const range = document.createRange();
                    range.setStart(node, idx);
                    range.setEnd(node, idx + needle.length);
                    ranges.push(range);
                    from = idx + needle.length;
                }
            }

            this.matches = ranges;
            this.matchIndex = ranges.length ? 0 : -1;
            this.paintHighlights();
            this.jump(0);
        }

        paintHighlights() {
            if (typeof CSS === 'undefined' || !CSS.highlights) return;
            if (!this.matches.length) {
                CSS.highlights.delete('editor-search');
                CSS.highlights.delete('editor-search-active');
                return;
            }
            CSS.highlights.set('editor-search', new Highlight(...this.matches));
            if (this.matchIndex >= 0 && this.matches[this.matchIndex]) {
                CSS.highlights.set('editor-search-active', new Highlight(this.matches[this.matchIndex]));
            } else {
                CSS.highlights.delete('editor-search-active');
            }
        }

        clearHighlights() {
            this.matches = [];
            this.matchIndex = -1;
            if (typeof CSS !== 'undefined' && CSS.highlights) {
                CSS.highlights.delete('editor-search');
                CSS.highlights.delete('editor-search-active');
            }
            this.findCount.textContent = '0/0';
        }

        jump(step) {
            if (!this.matches.length) {
                this.findCount.textContent = '0/0';
                return;
            }
            if (step !== 0) {
                this.matchIndex = (this.matchIndex + step + this.matches.length) % this.matches.length;
            }
            const range = this.matches[this.matchIndex];
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            this.paintHighlights();
            this.findCount.textContent = `${this.matchIndex + 1}/${this.matches.length}`;
        }

        syncActive() {
            for (const btn of this.toolbar.querySelectorAll('[data-cmd]')) {
                const cmd = btn.dataset.cmd;
                if (!TOGGLE_CMDS.has(cmd)) continue;
                let active = false;
                try {
                    active = document.queryCommandState(cmd);
                } catch {
                    active = false;
                }
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', String(active));
            }
        }

        setEnabled(enabled) {
            this.enabled = enabled;
            this.toolbar.classList.toggle('is-disabled', !enabled);
            this.editor.contentEditable = enabled ? 'true' : 'false';
            for (const btn of this.toolbar.querySelectorAll('button, input')) {
                btn.disabled = !enabled;
            }
            if (!enabled) this.closeFind();
        }
    }

    return EditorToolbar;
})();
