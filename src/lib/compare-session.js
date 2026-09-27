import { AiChat, getModelOption } from '@vanduo-oss/vdl-ai-chat';
import { chatRuntimeOptions, getChatDeviceCapabilities } from './chat-runtime.js';
import {
  createDocsSearch,
  retrieveDocs,
  citedSources,
  INSUFFICIENT_EVIDENCE,
} from './docs-search.js';
const emptyPane = () => ({
  status: 'Not loaded',
  loaded: false,
  error: '',
  turns: [],
  progress: '',
});
const clone = (value) => structuredClone(value);
const stopped = () => new DOMException('Comparison stopped.', 'AbortError');

/** State contains display data only. Engines, controllers, and promises are never reactive. */
export class CompareSession {
  constructor({
    modelA = 'gemma-4-E2B-it-web',
    createChat,
    retrieve,
    getDeviceSignals,
    onChange = () => {},
  } = {}) {
    this.createChat = createChat || ((id) => new AiChat({ modelId: id, ...chatRuntimeOptions }));
    this.retrieve = retrieve;
    this.getDeviceSignals = getDeviceSignals || getChatDeviceCapabilities;
    this.onChange = onChange;
    this.chats = [null, null];
    this.controllers = [null, null];
    this.histories = { general: [[], []], docs: [[], []] };
    this.transcripts = { general: [[], []], docs: [[], []] };
    this.archives = [];
    this.epoch = 0;
    this.closed = false;
    this.pending = Promise.resolve();
    this.state = {
      models: [modelA, ''],
      mode: 'general',
      execution: 'together',
      busy: false,
      loading: false,
      panes: [emptyPane(), emptyPane()],
      error: '',
      outputTokens: 1024,
      contextTokens: 4096,
      activePane: 0,
    };
  }
  emit() {
    this.onChange(clone(this.state));
  }
  async validate(id) {
    const model = getModelOption(id);
    if (!model || model.litertRuntime)
      throw new Error('Choose a browser-compatible catalog model.');
    // Injectable test engines do their own feature checks; real AiChat load checks remain authoritative.
    if (!this.system) this.system = await this.getDeviceSignals();
    if (this.system.webgpuSupported === false)
      throw new Error('WebGPU is unavailable in this browser.');
    if (model.requires.includes('shader-f16') && this.system.shaderF16 === false)
      throw new Error(
        'This precision requires shader-f16. Select a compatibility variant before loading.',
      );
  }
  async ensure(i) {
    if (this.chats[i]?.isLoaded()) return this.chats[i];
    const id = this.state.models[i];
    await this.validate(id);
    const chat = this.chats[i] || this.createChat(id, i);
    this.chats[i] = chat;
    this.state.panes[i].status = 'Loading';
    this.emit();
    const off = chat.onProgress?.((p) => {
      this.state.panes[i].progress = p.message || p.text || '';
      this.emit();
    });
    try {
      await chat.load();
      await chat.setHistory(this.histories[this.state.mode][i]);
      this.state.panes[i].loaded = true;
      this.state.panes[i].status = 'Ready';
      return chat;
    } finally {
      off?.();
      this.emit();
    }
  }
  async release(i) {
    const chat = this.chats[i];
    this.chats[i] = null;
    try {
      await chat?.dispose();
    } finally {
      this.state.panes[i].loaded = false;
      this.emit();
    }
  }
  async loadPair() {
    if (this.state.busy || this.state.loading) return;
    if (!this.state.models.every(Boolean)) throw new Error('Choose both models first.');
    this.closed = false;
    this.state.loading = true;
    this.state.error = '';
    this.emit();
    this.pending = (async () => {
      const epoch = this.epoch;
      for (let i = 0; i < 2; i++) {
        if (epoch !== this.epoch) throw stopped();
        if (this.state.execution === 'one-at-a-time') await this.release(1 - i);
        try {
          await this.ensure(i);
        } catch (error) {
          this.state.panes[i].error = error.message;
          this.state.panes[i].status = 'Load failed';
          throw error;
        }
      }
    })();
    try {
      await this.pending;
    } catch (error) {
      if (error.name !== 'AbortError')
        this.state.error = `${error.message} Try a smaller pair or One at a time.`;
    } finally {
      this.state.loading = false;
      this.emit();
    }
  }
  stop(i) {
    if (i === undefined) {
      this.epoch++;
      this.stop(0);
      this.stop(1);
      return;
    }
    this.controllers[i]?.abort();
    this.chats[i]?.cancel();
    const last = this.state.panes[i].turns.at(-1);
    if (last && last.status === 'queued') last.status = 'stopped';
  }
  async sources(prompt) {
    if (this.state.mode !== 'docs') return [];
    if (this.retrieve) return this.retrieve(prompt);
    if (!this.docsSearch) this.docsSearch = await createDocsSearch();
    return retrieveDocs(this.docsSearch, prompt);
  }
  async runSide(i, turn, epoch) {
    const pane = this.state.panes[i];
    if (epoch !== this.epoch || turn.status === 'stopped') {
      turn.status = 'stopped';
      return;
    }
    const controller = new AbortController();
    this.controllers[i] = controller;
    turn.status = 'running';
    turn.response = '';
    turn.error = '';
    pane.error = '';
    pane.status = 'Generating';
    this.emit();
    const start = performance.now();
    try {
      if (this.state.execution === 'one-at-a-time') await this.release(1 - i);
      const chat = await this.ensure(i);
      if (controller.signal.aborted || epoch !== this.epoch) throw stopped();
      await chat.setHistory(turn.history);
      const generateStart = performance.now();
      turn.loadMs = generateStart - start;
      if (turn.mode === 'docs' && !turn.sources.length) {
        turn.response = INSUFFICIENT_EVIDENCE;
        turn.evidenceMissing = true;
        await chat.setHistory([
          ...turn.history,
          { role: 'user', content: turn.prompt },
          { role: 'assistant', content: turn.response },
        ]);
      } else {
        turn.response = await chat.generate(turn.prompt, {
          signal: controller.signal,
          sources: turn.sources,
          contextTokenBudget: turn.contextTokens,
          maxOutputTokens: turn.outputTokens,
          onUpdate: (text) => {
            if (epoch !== this.epoch || controller.signal.aborted) return;
            turn.firstAnswerMs ??= performance.now() - generateStart;
            turn.response = text;
            this.emit();
          },
          onContext: (context) => {
            turn.context = context;
          },
          onFinish: (usage) => {
            turn.usage = usage;
          },
        });
      }
      if (epoch !== this.epoch || controller.signal.aborted) throw stopped();
      this.histories[turn.mode][i] = chat.getHistory();
      turn.status = 'complete';
      turn.citations = citedSources(turn.response, turn.sources);
      turn.generationMs = performance.now() - generateStart;
    } catch (error) {
      turn.status = controller.signal.aborted || error.name === 'AbortError' ? 'stopped' : 'failed';
      turn.error = error.message;
      pane.error = turn.status === 'failed' ? error.message : '';
    } finally {
      turn.elapsedMs = performance.now() - start;
      pane.status = turn.status === 'complete' ? 'Ready' : turn.status;
      this.controllers[i] = null;
      if (this.state.execution === 'one-at-a-time') await this.release(i);
      this.emit();
    }
  }
  async send(prompt) {
    if (!prompt.trim() || this.state.busy || this.state.loading) return;
    if (!this.state.models.every(Boolean)) throw new Error('Choose and load a pair first.');
    if (this.state.execution === 'together' && this.chats.some((c) => !c?.isLoaded()))
      throw new Error('Load both models before sending.');
    this.state.busy = true;
    this.state.error = '';
    const epoch = ++this.epoch;
    this.emit();
    this.pending = (async () => {
      const sources = await this.sources(prompt);
      if (epoch !== this.epoch) throw stopped();
      const turns = [0, 1].map((i) => ({
        prompt,
        sources: clone(sources),
        history: clone(this.histories[this.state.mode][i]),
        mode: this.state.mode,
        modelId: this.state.models[i],
        outputTokens: this.state.outputTokens,
        contextTokens: this.state.contextTokens,
        execution: this.state.execution,
        response: '',
        status: 'queued',
        citations: [],
      }));
      turns.forEach((turn, i) => {
        this.state.panes[i].turns.push(turn);
        this.state.panes[i].status = 'Queued';
      });
      this.emit();
      const twoLiteRT = this.state.models.every((id) => getModelOption(id)?.backend === 'litert');
      if (this.state.execution === 'one-at-a-time' || twoLiteRT) {
        await this.runSide(0, turns[0], epoch);
        await this.runSide(1, turns[1], epoch);
      } else await Promise.allSettled(turns.map((turn, i) => this.runSide(i, turn, epoch)));
    })();
    try {
      await this.pending;
    } catch (error) {
      if (error.name !== 'AbortError') this.state.error = error.message;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  async retry(i) {
    if (this.state.busy || this.state.loading) return;
    const turn = this.state.panes[i].turns.at(-1);
    if (!turn || !['failed', 'stopped'].includes(turn.status)) return;
    turn.status = 'queued';
    turn.firstAnswerMs = null;
    this.state.busy = true;
    const epoch = ++this.epoch;
    this.pending = this.runSide(i, turn, epoch);
    try {
      await this.pending;
    } finally {
      this.state.busy = false;
      this.emit();
    }
  }
  async settle() {
    this.stop();
    try {
      await this.pending;
    } catch {
      /* displayed */
    }
  }
  async setMode(mode) {
    if (mode === this.state.mode) return;
    await this.settle();
    this.transcripts[this.state.mode] = this.state.panes.map((p) => p.turns);
    this.state.mode = mode;
    this.state.panes.forEach((p, i) => {
      p.turns = this.transcripts[mode][i];
      p.error = '';
    });
    for (let i = 0; i < 2; i++) await this.chats[i]?.setHistory(this.histories[mode][i]);
    this.emit();
  }
  async newComparison() {
    await this.settle();
    this.archives.push(this.export());
    this.histories = { general: [[], []], docs: [[], []] };
    this.transcripts = { general: [[], []], docs: [[], []] };
    this.state.panes.forEach((p) => {
      p.turns = [];
      p.error = '';
      p.status = p.loaded ? 'Ready' : 'Not loaded';
    });
    for (const chat of this.chats) chat?.reset();
    this.state.error = '';
    this.emit();
  }
  async select(i, id) {
    if (id === this.state.models[i]) return;
    await this.newComparison();
    await this.release(0);
    await this.release(1);
    this.state.models[i] = id;
    this.emit();
  }
  async setExecution(execution) {
    await this.settle();
    await this.release(0);
    await this.release(1);
    this.state.execution = execution;
    this.emit();
  }
  export() {
    const modes = clone(this.transcripts);
    modes[this.state.mode] = clone(this.state.panes.map((p) => p.turns));
    return {
      schemaVersion: 1,
      kind: 'paired-chat',
      models: this.state.models.map((id) => getModelOption(id)),
      execution: this.state.execution,
      mode: this.state.mode,
      modes,
      exportedAt: new Date().toISOString(),
      timingNote: 'Together timings share GPU resources and are not isolated speed rankings.',
    };
  }
  async suspend() {
    await this.settle();
    await this.release(0);
    await this.release(1);
    await this.docsSearch?.dispose();
    this.docsSearch = null;
    this.state.panes.forEach((p) => {
      p.status = 'Not loaded';
    });
    this.emit();
  }
  async dispose() {
    this.closed = true;
    await this.suspend();
  }
}
