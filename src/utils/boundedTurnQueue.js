class BoundedTurnQueue {
    constructor(limit = 3) {
        this.limit = limit;
        this.items = [];
    }
    push(item) {
        if (this.items.length >= this.limit) return { accepted: false, item };
        this.items.push(item);
        return { accepted: true };
    }
    shift() {
        return this.items.shift();
    }
    clear() {
        this.items.length = 0;
    }
    get length() {
        return this.items.length;
    }
}

module.exports = { BoundedTurnQueue };
