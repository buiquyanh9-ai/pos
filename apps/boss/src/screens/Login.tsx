import { useState } from 'react';
import { getState, login } from '../lib/store';

export function Login() {
  const [url, setUrl] = useState(getState().url);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Nhập địa chỉ máy chủ của cửa hàng, ví dụ https://quan.t160.men hoặc http://192.168.1.10:4000');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(url, username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-brand">
        <img src="./logo.svg" alt="" width="64" height="64" className="login-logo" />
        <h1>ShopFlow Boss</h1>
        <p className="muted">Theo dõi doanh thu cửa hàng từ xa</p>
      </div>
      <form className="login-form" onSubmit={submit}>
        <label>
          Máy chủ
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:4000" autoCapitalize="off" autoCorrect="off" inputMode="url" />
        </label>
        <label>
          Tên đăng nhập
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="off" autoComplete="username" required />
        </label>
        <label>
          Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error-box">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
        <p className="muted small">Chỉ tài khoản Chủ cửa hàng. Dữ liệu mẫu: chu / chu123456.</p>
      </form>
    </div>
  );
}
