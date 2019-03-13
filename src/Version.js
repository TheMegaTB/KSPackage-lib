//@flow

const regex = {
    leadingDot: /^\./,
    release: /^\d:/,
    prefix: /^[a-zA-Z+_\-]+\.?/,
    appendage: {
        detect: /\.?\D+?$/,
        trim: /^[_.\-]+/,
    },
    component: {
        cleanup: /^\.(.*)\.$/,
        split: /[._\-]/
    }
};

export class Version {
    original: string;

    wildcard: boolean = false;

    release: string = '';
    components: Array<string>;
    appendage: string = '';

    constructor(input: string) {
        this.original = input;
        if (!input || input === 'any') this.wildcard = true;
        else {
            // Get a working copy
            let v = input;
            const errorMessage = `Unable to parse version '${input}'`;


            // Strip any leading dots
            v = v.replace(regex.leadingDot, '');


            // Strip any release prefixes (e.g. '1:')
            const release = v.match(regex.release);
            v = v.replace(regex.release, '');


            // Strip any letters from the beginning (e.g. 'V.')
            v = v.replace(regex.prefix, '');


            // Strip any appendages for further processing
            const appendage = v.match(regex.appendage.detect);
            v = v.replace(regex.appendage.detect, '');


            // Split the version into its components and bail if there are none
            const components = v.replace(regex.component.cleanup, '').split(regex.component.split);
            if (!v.length || !components.length) throw new Error(errorMessage);


            // Sanitize and store any interesting stuff
            if (release) this.release = release[0].replace(':', '');
            if (appendage) this.appendage = appendage[0].replace(regex.appendage.trim, '');
            this.components = components;
        }
    }

    get stringRepresentation() {
        let stringRepresentation = "";
        if (this.release.length > 0) stringRepresentation += this.release + ":";
        stringRepresentation += this.components.join('.');
        if (this.appendage.length > 0) stringRepresentation += "-" + this.appendage;

        return stringRepresentation;
    }

    static NEWER =  1;
    static EQUAL =  0;
    static OLDER = -1;
    static compare(a: any, b: any): number {
        if (a > b) return this.NEWER;
        else if (a < b) return this.OLDER;
        else return this.EQUAL;
    }

    compareAgainst(other: Version, maxComponentsCount: ?number) {
        // Check for wildcards
        if (this.wildcard || other.wildcard) return Version.EQUAL;

        // Compare the release
        const release = Version.compare(this.release, other.release);
        if (release !== Version.EQUAL) return release;

        // Compare the individual components
        let componentsCount = Math.min(this.components.length, other.components.length);
        if (maxComponentsCount) componentsCount = Math.min(maxComponentsCount, componentsCount);
        for (let i = 0; i < componentsCount; i++) {
            const component = Version.compare(this.components[i], other.components[i]);
            if (component !== Version.EQUAL) return component;
        }

        // If any of the two got more components it wins
        const componentCountComparison = Version.compare(
            maxComponentsCount ? Math.min(this.components.length, maxComponentsCount) : this.components.length,
            maxComponentsCount ? Math.min(other.components.length, maxComponentsCount) : other.components.length
        );
        if (componentCountComparison !== Version.EQUAL) return componentCountComparison;

        // Compare the appendages
        return Version.compare(this.appendage, other.appendage);
    }
}