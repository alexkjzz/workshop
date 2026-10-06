import { useState, type FormEvent } from 'react';
import type { SignInFailure } from '../../domain/session';
import './LoginForm.css';

const errorMessages: Record<SignInFailure, string> = {
  'invalid-credentials': 'Adresse e-mail ou mot de passe incorrect.',
  'rate-limited': 'Trop de tentatives. Réessayez dans une minute.',
  unknown: 'Connexion impossible.',
};

interface LoginFormProps {
  onSignIn: (email: string, password: string) => Promise<SignInFailure | null>;
}

export function LoginForm({ onSignIn }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    const failure = await onSignIn(email, password);
    if (failure) {
      setError(errorMessages[failure]);
      setSubmitting(false);
    }
  };

  return (
    <main className="login">
      <h1>SENTINEL-X</h1>
      <p className="login-subtitle">Centre de commandement — accès restreint</p>
      <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Adresse e-mail
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Connexion...' : 'Se connecter'}
        </button>
        <p className="message" role="alert">{error}</p>
      </form>
    </main>
  );
}
