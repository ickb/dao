export declare class Mutex<D> {
    #private;
    constructor(data: D);
    update(fn: (data: D) => PromiseLike<D>): Promise<void>;
}
