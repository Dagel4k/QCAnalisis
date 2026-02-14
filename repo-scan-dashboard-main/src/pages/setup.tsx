
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { API_URL } from '@/lib/config-client';
import { Lock, Loader2, CheckCircle2 } from 'lucide-react';

export default function Setup() {
    const [token, setToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!token.trim()) return;

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_URL}/api/setup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token.trim() }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Error al guardar la configuración');
            }

            setSuccess(true);
            // Wait a moment and redirect
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);

        } catch (err: any) {
            setError(err.message || 'Error desconocido');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md border-green-500/20 bg-green-500/5">
                    <CardContent className="pt-6 text-center space-y-4">
                        <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <h2 className="text-xl font-semibold text-green-700 dark:text-green-300">¡Configuración Guardada!</h2>
                        <p className="text-muted-foreground">Redirigiendo al dashboard...</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/50 p-4">
            <Card className="w-full max-w-lg shadow-lg">
                <CardHeader className="space-y-1">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 rounded-lg bg-primary/10">
                            <Lock className="w-5 h-5 text-primary" />
                        </div>
                        <span className="font-semibold tracking-tight text-lg">ScriptC Setup</span>
                    </div>
                    <CardTitle className="text-2xl">Bienvenido al Dashboard</CardTitle>
                    <CardDescription>
                        Para comenzar, necesitamos configurar tu token de acceso personal de GitLab.
                        Esto permitirá clonar repositorios y analizar el código.
                    </CardDescription>
                </CardHeader>
                <form onSubmit={handleSubmit}>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="token">GitLab Personal Access Token</Label>
                            <Input
                                id="token"
                                type="password"
                                placeholder="glpat-..."
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                autoComplete="off"
                                className="font-mono"
                            />
                            <p className="text-xs text-muted-foreground">
                                El token se guardará en tu archivo <code>.env</code> local únicamente.
                                Asegúrate de que tenga permisos <code>read_api</code> (o <code>api</code>) y <code>read_repository</code>.
                            </p>
                        </div>
                        {error && (
                            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                                {error}
                            </div>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" className="w-full" disabled={loading || !token.trim()}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar y Continuar
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
}
