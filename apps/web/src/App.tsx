import { NavLink, Route, Routes } from 'react-router';
import { NotFoundPage } from './pages/NotFoundPage';
import { TodosPage } from './pages/TodosPage';

export function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-2xl items-center gap-6 px-4 py-3 text-sm"
        >
          <span className="font-semibold">web-loop</span>
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'font-medium text-indigo-600' : '')}
          >
            Todos
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Routes>
          <Route path="/" element={<TodosPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
