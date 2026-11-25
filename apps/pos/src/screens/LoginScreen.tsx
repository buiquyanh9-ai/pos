import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CONNECTION_LABEL, cfg, getState, login, syncNow, usePos } from '../lib/store';
import { ROLE_LABEL, type User } from '../lib/types';
import { DataSphere } from '../components/DataSphere';

const WORDS = ['nhanh hơn', 'chính xác', 'gọn gàng', 'an tâm'];
const FEATURES = ['Đồng bộ với điện thoại chủ', 'Tự trừ kho theo món', 'Kiểm kê cuối ca', 'In hoá đơn & tổng kết ca', 'Báo cáo theo giờ', 'Vẫn bán khi mất mạng'];

/** Rotating word in the headline, typed in one character at a time. */
function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % WORDS.length), 2600);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="lx-word" aria-live="off">
      <span key={i} className="lx-word-in">
        {[...WORDS[i]].map((c, k) => (
          <span key={k} style={{ animationDelay: `${k * 45}ms` }}>
            {c === ' ' ? ' ' : c}
          </span>
        ))}
      </span>
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span>
      {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
    </span>
  );
}


/** Staff picker + PIN pad. Shown whenever no one is logged in on this terminal. */
export function LoginScreen({ onServerSettings }: { onServerSettings: () => void }) {
  const connection = usePos((s) => s.connection);
  const [staff, setStaff] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [who, setWho] = useState<User | null>(null);
  const [pin, setPin] = useState(0);
  const [pinLen, setPinLen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = () => {
    setLoadError(null);
    api
      .staff(cfg())
      .then((r) => setStaff(r.staff))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(loadStaff, [connection === 'offline' ? 0 : 1]);

  const pinText = pinLen ? String(pin).padStart(pinLen, '0') : '';
  const submit = async (code = pinText) => {
    if (!who || code.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await login(who.username, code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin(0);
      setPinLen(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen lx">
      <div className="lx-grid" aria-hidden="true" />
      <section className="lx-left">
        <span className="lx-eyebrow">
          <span className="lx-rule" /> ShopFlow POS
        </span>
        <h1 className="lx-title">
          <span>Bán hàng</span>
          <span>
            <RotatingWord />
          </span>
        </h1>
        <p className="lx-lead">Tạo đơn, thu tiền, trừ kho tự động và tổng kết ca. Mọi số liệu đồng bộ ngay về điện thoại của chủ cửa hàng.</p>
        <p className="lx-clock">
          <Clock />
        </p>
        <div className="lx-marquee" aria-hidden="true">
          <div className="lx-track">
            {[0, 1].map((n) => (
              <span key={n} className="lx-set">
                {FEATURES.map((f) => (
                  <span key={f} className="lx-feat">
                    <i /> {f}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="lx-right">
        <DataSphere className="lx-sphere" />
      <div className="login-card lx-card">
        <div className="login-brand">
          <img className="brand-mark" src="./logo.svg" alt="ShopFlow" />
          <div>
            <h1>ShopFlow POS</h1>
            <span className={`conn conn-${connection}`}>
              <span className="dot" /> {CONNECTION_LABEL[connection]}
            </span>
          </div>
        </div>

        {!who ? (
          <>
            <h2>Chọn nhân viên</h2>
            {loadError && (
              <p className="error-text">
                Không tải được danh sách nhân viên: {loadError}.{' '}
                <button className="link" onClick={() => (void syncNow(), loadStaff())}>
                  Thử lại
                </button>
              </p>
            )}
            <div className="staff-grid">
              {staff?.map((u) => (
                <button key={u.id} className="staff" onClick={() => (setWho(u), setError(null))}>
                  <span className="user-avatar">{u.name.slice(0, 1)}</span>
                  <strong>{u.name}</strong>
                  <small className="muted">{ROLE_LABEL[u.role]}</small>
                </button>
              ))}
            </div>
            {staff && !staff.length && <p className="muted">Chưa có nhân viên nào có mã PIN. Chủ cửa hàng cần tạo trên ứng dụng quản lý.</p>}
          </>
        ) : (
          <>
            <button className="link" onClick={() => (setWho(null), setPin(0), setPinLen(0))}>
              ‹ Đổi nhân viên
            </button>
            <h2>
              Nhập PIN · <span className="muted">{who.name}</span>
            </h2>
            <div className="pin-dots" aria-label={`${pinLen} chữ số đã nhập`}>
              {Array.from({ length: Math.max(4, pinLen) }, (_, i) => (
                <span key={i} className={i < pinLen ? 'on' : ''} />
              ))}
            </div>
            {error && <p className="error-text">{error}</p>}
            <PinPad
              disabled={busy}
              onDigit={(d) => {
                if (pinLen >= 8) return;
                setPin(pin * 10 + d);
                setPinLen(pinLen + 1);
              }}
              onBack={() => {
                setPin(Math.floor(pin / 10));
                setPinLen(Math.max(0, pinLen - 1));
              }}
              onEnter={() => void submit()}
            />
          </>
        )}
        <button className="link settings-link" onClick={onServerSettings}>
          ⚙ Cài đặt máy chủ ({getState().settings.backendUrl || 'chưa cấu hình'})
        </button>
      </div>
      </section>
    </div>
  );
}

function PinPad({ onDigit, onBack, onEnter, disabled }: { onDigit: (d: number) => void; onBack: () => void; onEnter: () => void; disabled: boolean }) {
  return (
    <div className="numpad pinpad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button key={d} className="key" disabled={disabled} onClick={() => onDigit(d)}>
          {d}
        </button>
      ))}
      <button className="key" disabled={disabled} onClick={onBack} aria-label="Xoá">
        ⌫
      </button>
      <button className="key" disabled={disabled} onClick={() => onDigit(0)}>
        0
      </button>
      <button className="key key-ok" disabled={disabled} onClick={onEnter}>
        OK
      </button>
    </div>
  );
}

