import { useCallback, useMemo, useState, type CSSProperties, type ChangeEvent } from 'react';

import { buildBrand, type Brand } from '../src/brand';
import { toBrandJsonText, toTokensCss } from '../src/emit';
import { DEFAULT_EXTRACT, extractPalette, EmblemError } from '../src/extract';
import { RAMP_STEPS } from '../src/ramp';
import { t, tf } from './i18n';

type State =
  | { kind: 'idle' }
  | { kind: 'busy'; step: 'decode' | 'extract' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; brand: Brand; fileName: string };

/** 把语义令牌表变成内联 CSS 变量，让预览面板直接吃生成出来的值。 */
function tokenStyle(tokens: Record<string, string>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) style[`--${name}`] = value;
  return style as CSSProperties;
}

async function decodeFile(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error(t('浏览器不支持读取图片像素'));
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { rgba: new Uint8Array(data), width: canvas.width, height: canvas.height };
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

const ROLE_KEYS = ['primary', 'secondary', 'accent'] as const;
const ROLE_LABELS = { primary: '主色', secondary: '次要色', accent: '点缀色' } as const;

function ContrastTable({ mode, brand }: { mode: 'light' | 'dark'; brand: Brand }) {
  const checks = brand.modes[mode].checks;
  return (
    <div className="contrast">
      <h4>{mode === 'light' ? t('浅色模式') : t('深色模式')}</h4>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('对比度检查')}</th>
            <th scope="col">{t('目标')}</th>
            <th scope="col">{t('达标')}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.label}>
              <th scope="row">
                <span
                  className="pair"
                  aria-hidden="true"
                  style={{ background: check.bg, color: check.fg }}
                >
                  Aa
                </span>
                {check.label}
              </th>
              <td>{check.ratio.toFixed(2)} / {check.min}</td>
              <td className={check.met ? 'ok' : 'bad'}>
                {check.met ? `✓ ${t('达标')}` : `✗ ${t('未达标')}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ mode, brand }: { mode: 'light' | 'dark'; brand: Brand }) {
  const style = tokenStyle(brand.modes[mode].tokens);
  return (
    <div className="preview" style={style} data-mode={mode}>
      <h4>{mode === 'light' ? t('浅色模式') : t('深色模式')}</h4>
      <div className="preview-surface">
        <p className="preview-card">
          <strong>{t('卡片')}</strong>
          <span className="preview-muted">{t('次要文字')}</span>
          <a href="#preview" onClick={(event) => event.preventDefault()}>
            {t('链接')}
          </a>
        </p>
        <div className="preview-actions">
          <span className="preview-button">{t('按钮')}</span>
          <span className="preview-button preview-button--secondary">{t('次要按钮')}</span>
        </div>
        <div className="preview-actions">
          <span className="preview-note preview-note--ok">{t('成功提示')}</span>
          <span className="preview-note preview-note--error">{t('错误提示')}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setState({ kind: 'busy', step: 'decode' });
    try {
      const image = await decodeFile(file);
      setState({ kind: 'busy', step: 'extract' });
      const extracted = extractPalette(image.rgba, image.width, image.height, DEFAULT_EXTRACT);
      const id = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'school';
      const brand = buildBrand({ id, name: id, extracted });
      setState({ kind: 'ready', brand, fileName: file.name });
    } catch (error) {
      const message =
        error instanceof EmblemError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('出现未知错误');
      setState({ kind: 'error', message });
    }
  }, []);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
  };

  const brand = state.kind === 'ready' ? state.brand : undefined;
  const failed = useMemo(
    () =>
      brand
        ? [...brand.modes.light.checks, ...brand.modes.dark.checks].filter((c) => !c.met).length
        : 0,
    [brand],
  );

  const copyPrimary = async () => {
    if (!brand) return;
    try {
      await navigator.clipboard.writeText(brand.palette.primary.ramp[brand.palette.primary.base]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="page">
      <header className="head">
        <h1>{t('校徽取色')}</h1>
        <p className="lead">{t('上传校徽，得到一套满足对比度要求的品牌令牌。颜色在浏览器里算，图片不会离开这台设备。')}</p>
      </header>

      <section className="picker" aria-labelledby="picker-title">
        <h2 id="picker-title">{t('选择校徽图片')}</h2>
        <input
          id="emblem"
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={onChange}
        />
        <div className="picker-actions">
          <label className="button" htmlFor="emblem">
            {brand ? t('换个图片') : t('选择校徽图片')}
          </label>
          <span className="hint">
            {t('支持')} {t('格式说明')}
          </span>
        </div>
        <p className="hint">{t('选好图片后会自动生成配色，不必再点按钮。')}</p>
      </section>

      <div role="status" aria-live="polite" className="status">
        {state.kind === 'busy' && (state.step === 'decode' ? t('正在读图…') : t('正在取色…'))}
        {state.kind === 'ready' && tf('取样说明', state.brand.source)}
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="alert">
          {state.message}
        </p>
      )}

      {brand && state.kind === 'ready' && (
        <>
          {failed > 0 && (
            <p role="alert" className="alert">
              {tf('有 {count} 项对比度未达标', { count: failed })}
            </p>
          )}
          {brand.monochrome && <p className="note">{t('单色徽标')}</p>}

          <section className="roles" aria-label={t('主色')}>
            {ROLE_KEYS.map((key) => {
              const role = brand.palette[key];
              return (
                <article className="role" key={key}>
                  <div className="swatch" style={{ background: role.ramp[role.base] }} aria-hidden="true" />
                  <h3>{t(ROLE_LABELS[key])}</h3>
                  <p className="mono">{role.ramp[role.base]}</p>
                  <p className="meta">
                    {t('基准级')} {role.base} · {t('色相')} {role.hue.toFixed(1)}° · {t('彩度')}{' '}
                    {role.chroma.toFixed(3)}
                  </p>
                </article>
              );
            })}
          </section>

          <section className="ramp" aria-labelledby="ramp-title">
            <h2 id="ramp-title">{t('色阶')}</h2>
            <ol className="ramp-list">
              {RAMP_STEPS.map((step) => (
                <li key={step}>
                  <span
                    className="chip"
                    style={{ background: brand.palette.primary.ramp[step] }}
                    aria-hidden="true"
                  />
                  <span className="mono">{step}</span>
                  <span className="mono muted">{brand.palette.primary.ramp[step]}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="previews" aria-labelledby="preview-title">
            <h2 id="preview-title">{t('配色预览')}</h2>
            <div className="preview-grid">
              <Preview mode="light" brand={brand} />
              <Preview mode="dark" brand={brand} />
            </div>
          </section>

          <section className="checks" aria-labelledby="checks-title">
            <h2 id="checks-title">{t('对比度检查')}</h2>
            <div className="preview-grid">
              <ContrastTable mode="light" brand={brand} />
              <ContrastTable mode="dark" brand={brand} />
            </div>
          </section>

          <section className="downloads" aria-labelledby="download-title">
            <h2 id="download-title">{t('下载')}</h2>
            <div className="picker-actions">
              <button className="button" type="button" onClick={() => download(`${brand.id}-tokens.css`, toTokensCss(brand))}>
                {t('下载令牌')}
              </button>
              <button className="button" type="button" onClick={() => download(`${brand.id}-brand.json`, toBrandJsonText(brand))}>
                {t('下载清单')}
              </button>
              <button className="button button--quiet" type="button" onClick={() => void copyPrimary()}>
                {copied ? t('已复制') : t('复制主色')}
              </button>
            </div>
            <p className="hint">{t('取色结果是候选')}</p>
          </section>
        </>
      )}

      {state.kind === 'idle' && <p className="note">{t('还没有结果')}</p>}
    </main>
  );
}
