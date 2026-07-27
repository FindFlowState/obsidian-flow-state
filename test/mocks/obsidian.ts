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

// The adapter is raw disk. Writes through it land on disk WITHOUT being
// registered with the Vault — which is exactly why the plugin must not use it
// for attachments (Obsidian's file index, and Sync on top of it, never learn
// about the file). `registered` below models that index.
class Adapter {
  fs = new Map<string, { type: 'file' | 'dir'; content?: string; bytes?: Uint8Array }>();
  async exists(p: string): Promise<boolean> { return this.fs.has(p); }
  async writeBinary(p: string, ab: ArrayBuffer) {
    this.fs.set(p, { type: 'file', bytes: new Uint8Array(ab) });
  }
}

class Vault {
  adapter: Adapter;
  /** Paths Obsidian knows about, i.e. written through the Vault API. */
  registered = new Set<string>();
  constructor() { this.adapter = new Adapter(); }
  async createFolder(p: string) { this.adapter.fs.set(p, { type: 'dir' }); this.registered.add(p); }
  async create(p: string, c: string) {
    this.adapter.fs.set(p, { type: 'file', content: c });
    this.registered.add(p);
    return new TFile(p);
  }
  async createBinary(p: string, ab: ArrayBuffer) {
    if (this.adapter.fs.has(p)) throw new Error(`File already exists: ${p}`);
    this.adapter.fs.set(p, { type: 'file', bytes: new Uint8Array(ab) });
    this.registered.add(p);
    return new TFile(p);
  }
  async modify(f: TFile, c: string) { this.adapter.fs.set(f.path, { type: 'file', content: c }); }
  async modifyBinary(f: TFile, ab: ArrayBuffer) {
    this.adapter.fs.set(f.path, { type: 'file', bytes: new Uint8Array(ab) });
  }
  async read(f: TFile) { return this.adapter.fs.get(f.path)?.content ?? ''; }
  async readBinary(f: TFile) {
    const bytes = this.adapter.fs.get(f.path)?.bytes ?? new Uint8Array();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  getAbstractFileByPath(p: string) {
    const entry = this.adapter.fs.get(p);
    // Unregistered files are invisible to Obsidian even though they're on disk.
    if (!entry || !this.registered.has(p)) return null;
    return entry.type === 'dir' ? new TFolder(p) : new TFile(p);
  }
  getAllLoadedFiles(): Array<TFile | TFolder> {
    const out: Array<TFile | TFolder> = [];
    for (const [p, v] of this.adapter.fs.entries()) {
      if (!this.registered.has(p)) continue;
      out.push(v.type === 'dir' ? new TFolder(p) : new TFile(p));
    }
    return out;
  }
  getName() { return 'Test Vault'; }
}

export class Setting {
  settingEl: HTMLElement = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  controlEl: HTMLElement = (typeof document !== 'undefined' ? document.createElement('div') : ({} as any));
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
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
  constructor() { this.app = { vault: new Vault() }; }
  addStatusBarItem() { return { setText(_: string) {} }; }
  addCommand(_: any) {}
  registerDomEvent(_: any, __: any, ___: any) {}
  registerObsidianProtocolHandler(_: any, __: any) {}
}

export const Platform = { isMobile: false };
export class Notice { constructor(_: string) {} }

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export type App = any;
