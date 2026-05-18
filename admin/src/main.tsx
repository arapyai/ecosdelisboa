import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import './styles.css';

const queryClient = new QueryClient();

function AdminShell() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="admin-shell">
        <section className="login-panel">
          <span>Login Admin</span>
          <h1>Lisboa por Outros</h1>
          <form>
            <label>
              Email
              <input type="email" placeholder="admin@example.com" />
            </label>
            <label>
              Password
              <input type="password" placeholder="••••••••" />
            </label>
            <button type="button">Entrar</button>
          </form>
        </section>
        <section className="dashboard-panel">
          <span>Dashboard Admin</span>
          <h2>Conteudo</h2>
          <div className="metric-grid">
            <article>
              <strong>-</strong>
              <small>Autores</small>
            </article>
            <article>
              <strong>-</strong>
              <small>Pontos</small>
            </article>
            <article>
              <strong>-</strong>
              <small>Percursos</small>
            </article>
          </div>
        </section>
      </main>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<AdminShell />);
