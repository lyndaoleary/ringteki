const _ = require('underscore');

class Event {
    constructor(name, params, merge = false, handler = () => true) {
        this.name = name;
        this.cancelled = false;
        this.shouldSkipHandler = false;
        this.handler = handler;

        if(merge) {
            _.extend(this, params);
            this.params = [this].concat([params]);
        } else {
            this.params = [this].concat(params);
        }
    }

    cancel() {
        this.cancelled = true;
    }

    skipHandler() {
        this.shouldSkipHandler = true;
    }
}

module.exports = Event;
