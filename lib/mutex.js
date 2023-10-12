"use strict";
/* Hacked together based on:
 * https://spin.atomicobject.com/2018/09/10/javascript-concurrency/
 */
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Mutex_instances, _Mutex_mutex, _Mutex_data, _Mutex_lock;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mutex = void 0;
class Mutex {
    constructor(data) {
        _Mutex_instances.add(this);
        _Mutex_mutex.set(this, void 0);
        _Mutex_data.set(this, void 0);
        __classPrivateFieldSet(this, _Mutex_mutex, Promise.resolve(), "f");
        __classPrivateFieldSet(this, _Mutex_data, data, "f");
    }
    async update(fn) {
        const unlock = await __classPrivateFieldGet(this, _Mutex_instances, "m", _Mutex_lock).call(this);
        try {
            __classPrivateFieldSet(this, _Mutex_data, await fn(__classPrivateFieldGet(this, _Mutex_data, "f")), "f");
        }
        finally {
            unlock();
        }
    }
}
exports.Mutex = Mutex;
_Mutex_mutex = new WeakMap(), _Mutex_data = new WeakMap(), _Mutex_instances = new WeakSet(), _Mutex_lock = function _Mutex_lock() {
    let begin = unlock => { };
    __classPrivateFieldSet(this, _Mutex_mutex, __classPrivateFieldGet(this, _Mutex_mutex, "f").then(() => {
        return new Promise(begin);
    }), "f");
    return new Promise(res => {
        begin = res;
    });
};
//# sourceMappingURL=mutex.js.map