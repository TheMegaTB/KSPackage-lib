'use script';

import request from "request-promise-native";
import fs from "fs-extra";

export const downloadFile = (url, target, responseReceivedCallback, progressCallback) => {
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
    sourceURL: string;
    destinationPath: string;

    loadedBytes: number = 0;
    totalBytes: number = 0;
    status: number = DownloadTask.Status.PENDING;

    _stream;

    // TODO Allow expected total size
    constructor(sourceURL, destinationPath, expectedTotal: number = 0) {
        this.sourceURL = sourceURL;
        this.destinationPath = destinationPath;
        this.totalBytes = expectedTotal;
    }

    start(onProgress): Promise<> {
        if (this.status !== DownloadTask.Status.PENDING)
            throw new Error("Attempted to start a non-pending DownloadTask.");

        const { promise, stream } = downloadFile(
            this.sourceURL,
            this.destinationPath,
            total => this.totalBytes = total,
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

    cancel() {
        if (this._stream) {
            this._stream.destroy();
            this.status = DownloadTask.Status.CANCELLED;
        }
    }
}

export default class DownloadManager {
    _tasks: Array<DownloadTask> = [];

    get loadedBytes(): number { return this._tasks.reduce((acc, task) => acc + task.loadedBytes, 0); }
    get totalBytes(): number { return this._tasks.reduce((acc, task) => acc + task.totalBytes, 0); }

    enqueue(task: DownloadTask): Promise<> {
        this._tasks.push(task);
        return task.start(() => {
            if (!this.progressDebounce) {
                this.progressDebounce = setTimeout(() => {
                    console.log("Download progress", this.loadedBytes / this.totalBytes);
                    this.progressDebounce = undefined;
                }, 500);
            }
        });
    }
}