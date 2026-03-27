// ==========================================
// VIRTUAL FILE SYSTEM
// ==========================================

export class VirtualFileSystem {
    constructor(initialState, onUpdate) {
        this.fs = JSON.parse(JSON.stringify(initialState));
        this.onUpdate = onUpdate;
    }

    _triggerUpdate() { if (this.onUpdate) this.onUpdate({ ...this.fs }); }

    resolvePath(path) {
        if (!path) return '/home/user';
        if (!path.startsWith('/')) path = '/home/user/' + path;
        path = path.replace(/\/\//g, '/');
        if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
        return path;
    }

    ls(path) {
        path = this.resolvePath(path);
        if (!this.fs[path]) return { error: `Directory not found: ${path}` };
        if (this.fs[path].type !== 'dir') return { error: `Not a directory: ${path}` };
        return { result: this.fs[path].contents.join('\n') || "(empty directory)" };
    }

    read(path) {
        path = this.resolvePath(path);
        if (!this.fs[path]) return { error: `File not found: ${path}` };
        if (this.fs[path].type !== 'file') return { error: `Not a file: ${path}` };
        return { result: this.fs[path].content };
    }

    write(path, content) {
        path = this.resolvePath(path);
        const parts = path.split('/');
        const filename = parts.pop();
        const dir = parts.join('/') || '/';
        if (!this.fs[dir]) return { error: `Directory not found: ${dir}` };
        if (this.fs[dir].type !== 'dir') return { error: `Not a directory: ${dir}` };
        if (!this.fs[dir].contents.includes(filename)) this.fs[dir].contents.push(filename);
        this.fs[path] = { type: 'file', content };
        this._triggerUpdate();
        return { result: `Successfully wrote ${content.length} bytes to ${path}` };
    }

    mkdir(path) {
        path = this.resolvePath(path);
        if (this.fs[path]) return { error: `Path already exists: ${path}` };
        const parts = path.split('/');
        const dirname = parts.pop();
        const parent = parts.join('/') || '/';
        if (!this.fs[parent]) return { error: `Parent directory not found: ${parent}` };
        if (this.fs[parent].type !== 'dir') return { error: `Parent is not a directory: ${parent}` };
        this.fs[parent].contents.push(dirname);
        this.fs[path] = { type: 'dir', contents: [] };
        this._triggerUpdate();
        return { result: `Created directory: ${path}` };
    }
}

export class VFSSyncAdapter {
    constructor(vfs) { this.vfs = vfs; }

    async readFile(path) {
        const res = this.vfs.read(path);
        if (res.error) throw new Error(res.error);
        return res.result;
    }

    async writeFile(path, content) {
        const res = this.vfs.write(path, content);
        if (res.error) throw new Error(res.error);
    }
}
