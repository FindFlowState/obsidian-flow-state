// Minimal Obsidian API mock for unit tests
export class TFile {
  path: string;
  name: string;
  extension?: string;
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || path;
    const idx = this.name.lastIndexOf('.');
    this.extension = idx >= 0 ? this.name.slice(idx + 1) : undefined;
  }
}

export class TFolder {
  path: string;
  name: string;
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || path;
  }
}

export abstract class AbstractInputSuggest<T> {
  protected app: any;
  protected inputEl: HTMLInputElement;
  constructor(app: any, inputEl: HTMLInputElement) {
    this.app = app;
    this.inputEl = inputEl;
  }
  abstract getSuggestions(_query: string): T[];
  abstract renderSuggestion(_value: T, _el: HTMLElement): void;
  abstract selectSuggestion(_value: T, _evt: MouseEvent | KeyboardEvent): void;
  close() {}
}

class Adapter {
  fs = new Map<string, { type: 'file' | 'dir'; content?: string }>();
  async exists(p: string): Promise<boolean> { return this.fs.has(p); }
  async writeBinary(p: string, ab: ArrayBuffer) {
    const len = new Uint8Array(ab).byteLength;
    this.fs.set(p, { type: 'file', content: String(len) });
  }
}

class Vault {
  adapter: Adapter;
  constructor() { this.adapter = new Adapter(); }
  async createFolder(p: string) { this.adapter.fs.set(p, { type: 'dir' }); }
  async create(p: string, c: string) { this.adapter.fs.set(p, { type: 'file', content: c }); }
  async modify(f: TFile, c: string) { this.adapter.fs.set(f.path, { type: 'file', content: c }); }
  async read(f: TFile) { return this.adapter.fs.get(f.path)?.content ?? ''; }
  getAbstractFileByPath(p: string) {
    const entry = this.adapter.fs.get(p);
    if (!entry) return null;
    return entry.type === 'dir' ? new TFolder(p) : new TFile(p);
  }
  getAllLoadedFiles(): Array<TFile | TFolder> {
    const out: Array<TFile | TFolder> = [];
    for (const [p, v] of this.adapter.fs.entries()) {
      out.push(v.type === 'dir' ? new TFolder(p) : new TFile(p));
    }
    return out;
  }
  getName() { return 'Test Vault'; }
}

// Small YAML-subset codec (scalars + string lists) so tests can assert the
// real file content produced through fileManager.processFrontMatter.
function coerceScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseFrontMatterBlock(raw: string): { fm: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---\n')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) return { fm: {}, body: raw };
  const yaml = raw.slice(4, end + 1);
  const body = raw.slice(end + 5);
  const fm: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s(.*)$/);
    if (listItem && currentListKey) {
      (fm[currentListKey] as unknown[]).push(coerceScalar(listItem[1]));
      continue;
    }
    const kv = line.match(/^([^:]+):\s?(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    if (kv[2] === '') {
      fm[key] = [];
      currentListKey = key;
    } else {
      fm[key] = coerceScalar(kv[2]);
      currentListKey = null;
    }
  }
  return { fm, body };
}

function stringifyFrontMatterBlock(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${String(item)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join('\n');
}

export class FileManager {
  constructor(private vault: Vault) {}
  async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void) {
    const raw = await this.vault.read(file);
    const { fm, body } = parseFrontMatterBlock(raw);
    fn(fm);
    const content = Object.keys(fm).length > 0
      ? `---\n${stringifyFrontMatterBlock(fm)}\n---\n${body}`
      : body;
    this.vault.adapter.fs.set(file.path, { type: 'file', content });
  }
}

export class Setting {
  settingEl: HTMLElement = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  controlEl: HTMLElement = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  setHeading() { return this; }
  addText(cb: (t: { setPlaceholder: (s: string) => any; setValue: (v: string) => any; setDisabled: (d: boolean) => any; onChange: (fn: (v: string) => void) => any; inputEl: HTMLInputElement }) => void) {
    const input = (typeof document !== 'undefined' ? document.createElement('input') : ({ style: {} } as any)) as HTMLInputElement;
    const api = {
      setPlaceholder: () => api,
      setValue: () => api,
      setDisabled: () => api,
      onChange: () => api,
      inputEl: input,
    } as any;
    cb(api);
    return this;
  }
  addDropdown(cb: (dd: { addOption: (k: string, v: string) => any; setValue: (v: string) => any; onChange: (fn: (v: string) => void) => any }) => void) {
    const api = { addOption: () => api, setValue: () => api, onChange: () => api } as any;
    cb(api);
    return this;
  }
  addToggle(cb: (tg: { setValue: (v: boolean) => any; onChange: (fn: (v: boolean) => void) => any }) => void) {
    const api = { setValue: () => api, onChange: () => api } as any;
    cb(api);
    return this;
  }
  addTextArea(cb: (ta: { setValue: (v: string) => any; onChange: (fn: (v: string) => void) => any; inputEl: HTMLTextAreaElement }) => void) {
    const input = (typeof document !== 'undefined' ? document.createElement('textarea') : ({ style: {} } as any)) as HTMLTextAreaElement;
    const api = { setValue: () => api, onChange: () => api, inputEl: input } as any;
    cb(api);
    return this;
  }
  addButton(cb: (b: ButtonComponent) => void) {
    const btn = new ButtonComponent(this.controlEl);
    cb(btn);
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLElement;
  constructor(container: HTMLElement) {
    this.buttonEl = (typeof document !== 'undefined' ? document.createElement('button') : ({} as any));
    if (container && (container as any).appendChild) (container as any).appendChild(this.buttonEl);
  }
  setButtonText(_t: string) { return this; }
  setCta() { return this; }
  setWarning() { return this; }
  setDisabled(_d: boolean) { return this; }
  onClick(_fn: () => void) { return this; }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement;
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  }
  display(): void {}
}

export class Plugin {
  app: any;
  manifest: any = { id: 'flow-state-obsidian' };
  constructor() {
    const vault = new Vault();
    this.app = { vault, fileManager: new FileManager(vault) };
  }
  addStatusBarItem() { return { setText(_: string) {} }; }
  addCommand(_: any) {}
  addSettingTab(_: any) {}
  registerView(_: any, __: any) {}
  registerEvent(_: any) {}
  registerDomEvent(_: any, __: any, ___: any) {}
  registerObsidianProtocolHandler(_: any, __: any) {}
}

export const Platform = { isMobile: false };
export class Notice {
  static shown: string[] = [];
  constructor(message: string, _timeoutMs?: number) {
    Notice.shown.push(String(message));
  }
}

export class WorkspaceLeaf {
  viewState: any = null;
  async setViewState(state: any) { this.viewState = state; }
}

export class ItemView {
  leaf: any;
  app: any = {};
  contentEl: HTMLElement = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  constructor(leaf: any) { this.leaf = leaf; }
  async setState(_state: any, _result: any) {}
  getState(): any { return {}; }
}

export const MarkdownRenderer = {
  render: async (_app: any, _md: string, _el: HTMLElement, _path: string, _cmp: any) => {},
};

export class Modal {
  app: any;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(app: any) {
    this.app = app;
    const mk = () => (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
    this.modalEl = mk();
    this.titleEl = mk();
    this.contentEl = mk();
  }
  open() { (this as any).onOpen?.(); }
  close() { (this as any).onClose?.(); }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export type App = any;
