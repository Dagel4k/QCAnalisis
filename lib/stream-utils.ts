import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { pick } from 'stream-json/filters/Pick';
import * as fs from 'fs';
import * as path from 'path';

export class StreamUtils {
    /**
     * Parses a JSON stream and counts items in an array at a specific path.
     * Use this for summarizing large tool outputs without loading everything.
     * 
     * @param stream Readable stream of JSON data
     * @param arrayPath Path to the array (e.g., "results", "findings"). If null, assumes root is array.
     */
    static async countItems(stream: NodeJS.ReadableStream, arrayPath: string | null): Promise<number> {
        return new Promise((resolve, reject) => {
            let count = 0;
            const pipeline = [parser()];
            
            if (arrayPath) {
                pipeline.push(pick({ filter: arrayPath }));
            }
            pipeline.push(streamArray());

            const processing = chain(pipeline);

            stream.pipe(processing);

            processing.on('data', () => {
                count++;
            });

            processing.on('end', () => resolve(count));
            processing.on('error', (err) => reject(err));
        });
    }

    /**
     * Streams a large JSON output to a file, returning only the summary count.
     * Useful for transforming tool output (stdout) to a file (disk) with low memory usage.
     */
    static async saveAndCount(
        inputStream: NodeJS.ReadableStream, 
        outputPath: string,
        arrayPath: string | null
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(outputPath);
            let count = 0;
            
            // Fork the stream: one to file, one to parser
            // Note: Standard streams in Node can be piped to multiple destinations.
            // But we need to be careful about backpressure.
            
            inputStream.pipe(fileStream);

            const pipeline = [parser()];
            if (arrayPath) {
                pipeline.push(pick({ filter: arrayPath }));
            }
            pipeline.push(streamArray());
            
            const countChain = chain(pipeline);
            inputStream.pipe(countChain);

            countChain.on('data', () => count++);
            
            let completed = 0;
            const checkDone = () => {
                completed++;
                if (completed === 2) resolve(count);
            };

            fileStream.on('finish', checkDone);
            countChain.on('end', checkDone);
            
            fileStream.on('error', reject);
            countChain.on('error', reject);
        });
    }
}
