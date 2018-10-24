export function DelayPromise(delay) {
    //return a function that accepts a single variable
    return data => {
        //this function returns a promise.
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                //a promise that is resolved after "delay" milliseconds with the data provided
                resolve(data);
            }, delay);
        });
    }
}

const concat = (x, y) => x.concat(y);
export const flatMap = (xs, f) => xs.map(f).reduce(concat, []);

export const any = (arrayOrString, prefix) => {
    return (arrayOrString instanceof Array)
        ? arrayOrString.reduce((acc, x) => acc || prefix(x), false)
        : prefix(arrayOrString);
};

export const contains = (searchable, element) => searchable.indexOf(element) > -1;

export const flatten = function(arr, result = []) {
    for (let i = 0, length = arr.length; i < length; i++) {
        const value = arr[i];
        if (Array.isArray(value)) {
            flatten(value, result);
        } else {
            result.push(value);
        }
    }
    return result;
};

export const regexEscape = str => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

export const getLeadingPath = path => /\//.test(path) ? path.replace(/(^.*)\/.+/, '$1') : "";