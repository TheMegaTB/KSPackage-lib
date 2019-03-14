//@flow
import type {URL} from "./internal";

export type ModIdentifier = string;

export type ModReference = { name: string };

export type ModInstallDirective = {
    file: ?string;
    find: ?string;
    find_regexp: ?string;

    find_matches_files: ?boolean;

    install_to: ?string;
    as: ?string;
    filter: ?Array<string>;
    filter_regexp: ?Array<string>;
    include_only: ?Array<string>;
    include_only_regexp: ?Array<string>;
};

export type ModResources = {
    homepage: ?URL,
    bugtracker: ?URL,
    repository: ?URL,
    ci: ?URL,
    spacedock: ?URL,
    curse: ?URL,
    x_screenshot: ?URL,
    x_curse: ?URL
};

export type CKANModSpecification = {
    kind: string,
    name: ModIdentifier,
    abstract: string,
    identifier: string,
    author: string | [string],
    description: string,
    download: URL,
    download_size: number,
    license: string,
    releaseStatus: string,
    version: string,
    ksp_version: ?string,
    ksp_version_min: ?string,
    ksp_version_max: ?string,
    ksp_version_strict: ?boolean,
    tags: ?Array<string>,
    install: ?Array<ModInstallDirective>,
    depends: ?Array<ModReference>,
    conflicts: ?Array<ModReference>,
    provides: ?Array<string>,
    recommends: ?Array<ModReference>,
    suggests: ?Array<ModReference>,
    resources: ModResources
};