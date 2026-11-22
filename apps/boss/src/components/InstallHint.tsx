import { useState } from 'react';

const KEY = 'shopflow.boss.installHint';

function shouldShow() {
  try {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    return ios && !standalone && localStorage.getItem(KEY) !== 'hidden';
  } catch {
    return false;
  }
}

/** iPhone Safari: explain how to install the app on the home screen (no App Store needed). */
export function InstallHint() {
  const [show, setShow] = useState(shouldShow);
  if (!show) return null;
  const hide = () => {
    try {
      localStorage.setItem(KEY, 'hidden');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div className="install-hint" role="note">
      <img src="./icons/icon-180.png" alt="" width={44} height={44} />
      <div>
        <strong>Cài ShopFlow Boss lên iPhone</strong>
        <span>
          Bấm nút Chia sẻ <b>⬆︎</b> ở thanh Safari → <b>Thêm vào MH chính</b>. App sẽ mở toàn màn hình như ứng dụng.
        </span>
      </div>
      <button aria-label="Ẩn" onClick={hide}>
        ✕
      </button>
    </div>
  );
}
