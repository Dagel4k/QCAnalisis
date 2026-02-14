import { IScanner, AnalysisContext } from './scanner.interface';
import { ScanResult } from './scanner.types';

export class ScannerRegistry {
    private scanners: Map<string, IScanner> = new Map();

    /**
     * Registers a scanner instance.
     * @param scanner The scanner implementation to register.
     */
    public register(scanner: IScanner): void {
        if (this.scanners.has(scanner.name)) {
            console.warn(`[ScannerRegistry] Overwriting existing scanner: ${scanner.name}`);
        }
        this.scanners.set(scanner.name, scanner);
    }

    /**
     * Retrieves a registered scanner by name.
     */
    public get(name: string): IScanner | undefined {
        return this.scanners.get(name);
    }

    /**
     * Returns all registered scanners.
     */
    public getAll(): IScanner[] {
        return Array.from(this.scanners.values());
    }

    /**
     * Runs all registered and enabled scanners concurrently.
     * @param context The analysis context.
     */
    public async runAll(context: AnalysisContext): Promise<ScanResult[]> {
        const promises = Array.from(this.scanners.values()).map(scanner => {
            // The BaseScanner.run() method handles isEnabled check and errors
            return scanner.run(context);
        });

        return await Promise.all(promises);
    }
}
