'use strict';
//@flow

import request from "request-promise-native";
import fs from "fs-extra";
import type {Path} from "../types/internal";
import type {URL} from "../types/internal";

export const downloadFile = (url: URL, target: Path, responseReceivedCallback: (number) => void, progressCallback: (number) => void): { promise: Promise<void>, stream: WritableStream } => {
    const writeStream = fs.createWriteStream(target, {flags: 'w'});

    let downloadedSize = 0;

    const promise = new Promise((resolve, reject) => {
        request.get(url)
            .on('response', data => {
                responseReceivedCallback(parseInt(data.headers['content-length']));
            })
            .on('data', data => {
                downloadedSize += data.length;
                if (typeof progressCallback === 'function') progressCallback(downloadedSize);
            })
            .on('error', err => {
                writeStream.close();
                fs.unlink(target);
                reject(err.message);
            })
            .pipe(writeStream);

        writeStream.on('finish', () => {
            resolve();
        });
        writeStream.on('error', err => {
            writeStream.close();
            if (err.code !== 'EEXIST') fs.unlink(target);
            reject(err.message);
        })
    });

    return {
        promise,
        stream: writeStream
    }
};

export class DownloadTask {
    static Status = {
        PENDING: 0,
        RUNNING: 1,
        CANCELLED: 2,
        FINISHED: 3
    };

    identifier: string;
    sourceURL: URL;
    destinationPath: Path;

    loadedBytes: number = 0;
    totalBytes: number = 0;
    status: number = DownloadTask.Status.PENDING;

    _stream: WritableStream;

    constructor(sourceURL: URL, destinationPath: Path, expectedTotal: number = 0) {
        this.sourceURL = sourceURL;
        this.destinationPath = destinationPath;
        this.totalBytes = expectedTotal;
    }

    start(onProgress: () => void): Promise<void> {
        if (this.status !== DownloadTask.Status.PENDING)
            throw new Error("Attempted to start a non-pending DownloadTask.");

        const { promise, stream } = downloadFile(
            this.sourceURL,
            this.destinationPath,
            total => { this.totalBytes = total },
            loaded => {
                this.loadedBytes = loaded;
                onProgress();
            }
        );

        this._stream = stream;

        return promise.then(() => {
            this.status = DownloadTask.Status.FINISHED;
        });
    }

    async cancel(reason: string = "Unspecified"): Promise<void> {
        if (this._stream) {
            await this._stream.abort(reason);
            this.status = DownloadTask.Status.CANCELLED;
        }
    }
}

export default class DownloadManager {
    _tasks: Array<DownloadTask> = [];
    _progressDebounce: ?TimeoutID;

    get loadedBytes(): number { return this._tasks.reduce((acc, task) => acc + task.loadedBytes, 0); }
    get totalBytes(): number { return this._tasks.reduce((acc, task) => acc + task.totalBytes, 0); }

    enqueue(task: DownloadTask): Promise<void> {
        this._tasks.push(task);
        return task.start(() => {
            if (!this._progressDebounce) {
                this._progressDebounce = setTimeout(() => {
                    console.log("Download progress", this.loadedBytes / this.totalBytes);
                    this._progressDebounce = undefined;
                }, 1500);
            }
        });
    }
}