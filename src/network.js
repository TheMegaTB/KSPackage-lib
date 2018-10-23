// //@flow
// import request from 'request';
// import fs from 'fs';
//
// const downloadNotifyInterval: number = 1024 * 100; // Bytes
//
// export function downloadFile(url: string, dest: string, progressCallback: ?(number) => mixed): Promise<string> {
//     return new Promise((resolve, reject) => {
//         const file = fs.createWriteStream(dest, { flags: "w" });
//         let totalSize = 0;
//         let lastNotification = 0;
//         let downloaded = 0;
//
//         request.get(url)
//             .on('response', data => {
//                 totalSize = data.headers['content-length'];
//             })
//             .on('data', data => {
//                 downloaded += data.length;
//                 if (lastNotification + downloadNotifyInterval < downloaded) {
//                     lastNotification = downloaded;
//                     if (typeof progressCallback === 'function') progressCallback(downloaded / totalSize);
//                 }
//             })
//             .on('error', function(err) {
//                 file.close();
//                 fs.unlink(dest, () => {}); // Delete temp file
//                 reject(err.message);
//             })
//             .pipe(file);
//
//         file.on("finish", () => {
//             if (typeof progressCallback === 'function') progressCallback(1);
//             resolve(dest);
//         });
//
//         file.on("error", err => {
//             file.close();
//
//             if (err.code === "EEXIST") {
//                 reject("File already exists");
//             } else {
//                 fs.unlink(dest, () => {}); // Delete temp file
//                 reject(err.message);
//             }
//         });
//     });
// }