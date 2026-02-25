import { BaseScanner } from './base.scanner';
import { AnalysisContext } from './scanner.interface';
import { Issue } from './scanner.types';
// @ts-ignore
import { diagnose } from 'react-doctor/api';

export class ReactDoctorScanner extends BaseScanner {
    name = 'React Doctor';
    version = 'latest';

    isEnabled(context: AnalysisContext): boolean {
        if (!super.isEnabled(context)) return false;
        // Solo aplica a proyectos que tengan un package.json
        const pkgPath = context.cwd + '/package.json';
        const fs = require('fs');
        if (!fs.existsSync(pkgPath)) return false;

        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            // Activar si el proyecto usa react
            return !!deps['react'];
        } catch {
            return false;
        }
    }

    protected async execute(context: AnalysisContext): Promise<Issue[]> {
        context.logger.log(`[React Doctor] Iniciando escaneo en: ${context.cwd}`);

        try {
            const result = await diagnose(context.cwd, {
                lint: true,
                deadCode: true
            });

            if (!result || !result.diagnostics) {
                return [];
            }

            return result.diagnostics
                .filter((diag: any) => {
                    const ruleCode = String(diag.rule || '').toLowerCase();
                    const pluginName = String(diag.plugin || '').toLowerCase();

                    // Ignorar reportes de archivos, exports o tipos duplicados (ya los reporta knip local)
                    if (
                        ['files', 'exports', 'types', 'dependencies'].includes(ruleCode) ||
                        ['files', 'exports', 'types', 'dependencies'].includes(pluginName)
                    ) {
                        return false;
                    }

                    // Ignorar la policía de formato "Unicorn" completa
                    if (ruleCode.startsWith('unicorn') || pluginName.includes('unicorn')) {
                        return false;
                    }

                    return true;
                })
                .map((diag: any) =>
                    this.createIssue(
                        diag.severity === 'error' ? 'high' : 'medium',
                        diag.message,
                        diag.filePath,
                        diag.line,
                        {
                            col: diag.column,
                            code: diag.rule,
                            context: {
                                plugin: diag.plugin,
                                category: diag.category,
                                help: diag.help
                            }
                        }
                    )
                );
        } catch (error: any) {
            context.logger.log(`[React Doctor] Error al ejecutar: ${error.message}`);
            return [];
        }
    }
}
