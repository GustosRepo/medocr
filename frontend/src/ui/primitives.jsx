import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const spacingScale = { xs: '0.5rem', sm: '0.75rem', md: '1rem', lg: '1.5rem', xl: '2rem' };

function resolveSpace(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return `${value}px`;
  return spacingScale[value] || value;
}

function consumeSpacingProps(props) {
  const {
    mt,
    mb,
    ml,
    mr,
    mx,
    my,
    pt,
    pb,
    pl,
    pr,
    px,
    py,
    style: styleProp = {},
    ...rest
  } = props;
  const style = { ...styleProp };

  const applyMargin = (prop, value) => {
    if (value !== undefined) style[prop] = resolveSpace(value);
  };
  const applyPadding = (prop, value) => {
    if (value !== undefined) style[prop] = resolveSpace(value);
  };

  if (mx !== undefined) {
    const val = resolveSpace(mx);
    style.marginLeft = val;
    style.marginRight = val;
  }
  if (my !== undefined) {
    const val = resolveSpace(my);
    style.marginTop = val;
    style.marginBottom = val;
  }
  if (px !== undefined) {
    const val = resolveSpace(px);
    style.paddingLeft = val;
    style.paddingRight = val;
  }
  if (py !== undefined) {
    const val = resolveSpace(py);
    style.paddingTop = val;
    style.paddingBottom = val;
  }

  applyMargin('marginTop', mt);
  applyMargin('marginBottom', mb);
  applyMargin('marginLeft', ml);
  applyMargin('marginRight', mr);

  applyPadding('paddingTop', pt);
  applyPadding('paddingBottom', pb);
  applyPadding('paddingLeft', pl);
  applyPadding('paddingRight', pr);

  return [rest, style];
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'solid',
  size = 'sm',
  component,
  type = 'button',
  disabled = false,
  children,
  className = '',
  loading = false,
  fullWidth = false,
  leftSection,
  onClick,
  ...rest
}) {
  const base = 'inline-flex items-center justify-center font-medium rounded focus:outline-none transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = { xs: 'px-2 py-1 text-[11px]', sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', 'compact-xs': 'px-2 py-0.5 text-[11px]' };
  const variants = {
    solid: 'bg-blue-600 hover:bg-blue-500 text-white',
    light: 'bg-slate-700/60 hover:bg-slate-600/60 text-slate-100',
    outline: 'border border-slate-500 text-slate-100 hover:bg-slate-700/40',
    subtle: 'text-slate-300 hover:bg-slate-700/40',
    default: 'bg-slate-800 hover:bg-slate-700 text-slate-100',
    filled: 'bg-blue-500 hover:bg-blue-400 text-white'
  };
  const Component = component || 'button';
  const isButton = typeof Component === 'string' ? Component === 'button' : false;
  const finalDisabled = disabled || loading;
  const interactiveProps = {};
  if (isButton) {
    interactiveProps.type = type;
    interactiveProps.disabled = finalDisabled;
  } else if (finalDisabled) {
    interactiveProps['aria-disabled'] = 'true';
    interactiveProps.tabIndex = -1;
  }
  const handleClick = event => {
    if (!isButton && finalDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  return (
    <Component
      className={cx(base, sizes[size] || sizes.sm, variants[variant] || variants.solid, fullWidth ? 'w-full' : '', className)}
      {...interactiveProps}
      aria-busy={loading ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading && <span className="animate-spin mr-1 border-2 border-t-transparent border-current rounded-full w-3 h-3" />}
      {leftSection && <span className="mr-1 inline-flex">{leftSection}</span>}
      {children}
    </Component>
  );
}

export function Badge({ color = 'gray', variant = 'light', size = 'sm', children, className = '' }) {
  const colorMap = {
    gray: 'bg-slate-700 text-slate-200',
    green: 'bg-emerald-600 text-white',
    red: 'bg-rose-600 text-white',
    blue: 'bg-sky-600 text-white',
    yellow: 'bg-amber-500 text-black',
    orange: 'bg-orange-500 text-black'
  };
  const base = 'inline-flex items-center rounded px-2 py-0.5 font-medium';
  const sizes = { xs: 'text-[10px]', sm: 'text-[11px]', md: 'text-xs' };
  const styleClass = variant === 'outline' ? 'border border-slate-500 text-slate-200' : (colorMap[color] || colorMap.gray);
  return <span className={cx(base, sizes[size] || sizes.sm, styleClass, className)}>{children}</span>;
}

export function Stack({ gap = 'md', className = '', children, align = 'stretch', justify = 'flex-start', style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const gapMap = { none: 'gap-0', xs: 'gap-2', sm: 'gap-3', md: 'gap-4', lg: 'gap-6', xl: 'gap-8' };
  const alignMap = {
    center: 'items-center',
    'flex-start': 'items-start',
    start: 'items-start',
    'flex-end': 'items-end',
    end: 'items-end',
    stretch: 'items-stretch'
  };
  const justifyMap = {
    center: 'justify-center',
    'flex-start': 'justify-start',
    start: 'justify-start',
    'flex-end': 'justify-end',
    end: 'justify-end',
    'space-between': 'justify-between'
  };
  const gapClass = typeof gap === 'number' ? '' : (gapMap[gap] || gapMap.md);
  if (typeof gap === 'number') spacingStyle.gap = resolveSpace(gap);
  return (
    <div
      className={cx('flex flex-col', gapClass, alignMap[align] || '', justifyMap[justify] || '', className)}
      style={spacingStyle}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Group({ gap = 'sm', className = '', wrap = 'wrap', justify = 'flex-start', align = 'center', children, style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const gapMap = { none: 'gap-0', xs: 'gap-1', sm: 'gap-2', md: 'gap-3', lg: 'gap-4', xl: 'gap-6' };
  const justifyMap = {
    center: 'justify-center',
    'flex-start': 'justify-start',
    start: 'justify-start',
    'flex-end': 'justify-end',
    end: 'justify-end',
    'space-between': 'justify-between'
  };
  const alignMap = {
    center: 'items-center',
    'flex-start': 'items-start',
    start: 'items-start',
    'flex-end': 'items-end',
    end: 'items-end',
    stretch: 'items-stretch'
  };
  const gapClass = typeof gap === 'number' ? '' : (gapMap[gap] || gapMap.sm);
  if (typeof gap === 'number') spacingStyle.gap = resolveSpace(gap);
  const wrapClass = wrap === 'nowrap' ? 'flex-nowrap' : 'flex-wrap';
  return (
    <div
      className={cx('flex flex-row', wrapClass, gapClass, justifyMap[justify] || '', alignMap[align] || '', className)}
      style={spacingStyle}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Text({ size = 'sm', children, className = '', c, fw, component = 'div', tt, lineClamp, style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const sizeMap = { xs: 'text-[11px]', sm: 'text-[12px]', md: 'text-sm', lg: 'text-base' };
  const colorMap = {
    dimmed: 'text-slate-400',
    red: 'text-rose-400',
    yellow: 'text-amber-400',
    green: 'text-emerald-400',
    blue: 'text-sky-400',
    orange: 'text-orange-400'
  };
  const weightMap = {
    400: 'font-normal',
    500: 'font-medium',
    600: 'font-semibold',
    700: 'font-bold',
    normal: 'font-normal',
    medium: 'font-medium',
    semibold: 'font-semibold',
    bold: 'font-bold'
  };
  const transformMap = { uppercase: 'uppercase', capitalize: 'capitalize', lowercase: 'lowercase' };
  if (typeof size === 'number') spacingStyle.fontSize = resolveSpace(size);
  const classes = cx(sizeMap[size] || '', colorMap[c] || '', weightMap[fw] || '', transformMap[tt] || '', className);
  if (lineClamp) {
    spacingStyle.display = '-webkit-box';
    spacingStyle.WebkitLineClamp = lineClamp;
    spacingStyle.WebkitBoxOrient = 'vertical';
    spacingStyle.overflow = 'hidden';
  }
  const Comp = component;
  return (
    <Comp className={classes} style={spacingStyle} {...rest}>
      {children}
    </Comp>
  );
}

export function Code({ children, className = '', size = 'xs', fz }) {
  const resolvedSize = fz || size;
  const sizeMap = { xs: 'text-[11px]', sm: 'text-xs', md: 'text-sm' };
  return (
    <code className={cx('font-mono px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-600', sizeMap[resolvedSize] || '', className)}>
      {children}
    </code>
  );
}

export function Paper({ withBorder, radius = 'md', p = 'md', className = '', children, shadow, style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const radiusMap = { xs: 'rounded-sm', sm: 'rounded', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl' };
  const paddingMap = { xs: 'p-2', sm: 'p-3', md: 'p-4', lg: 'p-6', xl: 'p-8' };
  const shadowMap = { xs: 'shadow-sm', sm: 'shadow', md: 'shadow-md', lg: 'shadow-lg' };
  return (
    <div
      className={cx(
        'bg-slate-900/70',
        withBorder ? 'border border-slate-700' : '',
        radiusMap[radius] || radiusMap.md,
        paddingMap[p] || paddingMap.md,
        shadow ? (shadowMap[shadow] || shadow) : '',
        className
      )}
      style={spacingStyle}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ScrollArea({ h, children, className = '', offsetScrollbars, style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const maxHeight = h ? (typeof h === 'number' ? `${h}px` : h) : undefined;
  return (
    <div
      className={cx('overflow-y-auto thin-scroll', className)}
      style={{ ...spacingStyle, maxHeight }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Title({ order = 3, children, className = '' }) {
  const Tag = `h${order}`;
  const sizeClass = order === 1 ? 'text-3xl' : order === 2 ? 'text-2xl' : order === 3 ? 'text-xl' : 'text-lg';
  return <Tag className={cx('font-semibold tracking-tight', sizeClass, className)}>{children}</Tag>;
}

export function Checkbox({ checked, onChange, size = 'xs', className = '', ...props }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={cx('accent-sky-500', size === 'xs' ? 'w-3.5 h-3.5' : 'w-4 h-4', className)}
      {...props}
    />
  );
}

export function ActionIcon({ children, size = 'sm', className = '', variant = 'subtle', component, style, ...props }) {
  const [rest, spacingStyle] = consumeSpacingProps({ ...props, style });
  const Component = component || 'button';
  const sizeClass = size === 'sm' ? 'w-6 h-6' : size === 'md' ? 'w-8 h-8' : 'w-10 h-10';
  const variantMap = {
    subtle: 'hover:bg-slate-700/60 text-slate-200',
    light: 'bg-slate-800 hover:bg-slate-700 text-slate-100',
    outline: 'border border-slate-600 hover:bg-slate-800 text-slate-100',
    default: 'bg-slate-800 hover:bg-slate-700 text-slate-100'
  };
  const isButton = typeof Component === 'string' ? Component === 'button' : false;
  return (
    <Component
      className={cx('inline-flex items-center justify-center rounded transition disabled:opacity-40', sizeClass, variantMap[variant] || variantMap.subtle, className)}
      style={spacingStyle}
      type={isButton ? 'button' : undefined}
      {...rest}
    >
      {children}
    </Component>
  );
}

export function Tooltip({ label, children }) {
  return (
    <span title={typeof label === 'string' ? label : undefined} className="inline-flex">
      {children}
    </span>
  );
}

export function JsonInput({ value, className = '', rows = 28, minRows, styles, style, readOnly = true, autosize, ...props }) {
  const minHeight = minRows ? `${Number(minRows) * 18}px` : undefined;
  const mergedStyle = { ...style, ...(styles?.input || {}) };
  if (minHeight && !mergedStyle.minHeight) {
    mergedStyle.minHeight = minHeight;
  }
  return (
    <textarea
      value={value}
      readOnly={readOnly}
      className={cx('w-full font-mono text-[11px] leading-4 bg-slate-950 border border-slate-700 rounded p-2 resize-y', className)}
      rows={rows}
      style={mergedStyle}
      {...props}
    />
  );
}

// Minimal accessible MultiSelect (checkbox dropdown)
export function MultiSelect({ data = [], value = [], onChange = () => {}, placeholder = 'Select', searchable = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef();
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const filtered = !searchable || !query ? data : data.filter(d => d.toLowerCase().includes(query.toLowerCase()));
  const toggle = itm => {
    const set = new Set(value);
    if (set.has(itm)) set.delete(itm);
    else set.add(itm);
    onChange(Array.from(set));
  };
  const label = value.length ? `${value.length} selected` : placeholder;
  return (
    <div className={cx('relative text-xs', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">{label}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-[220px] max-h-72 overflow-auto rounded border border-slate-600 bg-slate-900 shadow-lg">
          {searchable && (
            <div className="p-1">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1"
              />
            </div>
          )}
          <ul className="py-1">
            {filtered.map(it => {
              const active = value.includes(it);
              return (
                <li key={it}>
                  <button
                    type="button"
                    onClick={() => toggle(it)}
                    className={cx('flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-slate-700/60', active ? 'text-sky-300' : '')}
                  >
                    <input type="checkbox" readOnly checked={active} className="accent-sky-500 w-3.5 h-3.5" />
                    <span className="truncate flex-1">{it}</span>
                  </button>
                </li>
              );
            })}
            {!filtered.length && <li className="px-2 py-1 text-slate-500">No results</li>}
          </ul>
          <div className="border-t border-slate-600 flex gap-1 p-1">
            <Button size="xs" variant="subtle" onClick={() => onChange([])}>
              Clear
            </Button>
            <Button size="xs" variant="subtle" onClick={() => onChange(data)}>
              All
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const ToastContext = createContext({ push: () => {} });

export function NotificationsProvider({ children }) {
  const [items, setItems] = useState([]);
  function push({ title, message, color = 'blue', autoClose = 3000 }) {
    const id = Math.random().toString(36).slice(2);
    setItems(ls => [...ls, { id, title, message, color }]);
    if (autoClose) setTimeout(() => setItems(ls => ls.filter(i => i.id !== id)), autoClose);
  }
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 flex flex-col gap-2 z-50 w-80 max-w-[90vw]">
        {items.map(it => (
          <div
            key={it.id}
            className={cx(
              'rounded border shadow px-3 py-2 text-xs bg-slate-900/90 backdrop-blur border-slate-600 flex flex-col'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={cx('font-semibold', `text-${it.color}-400`)}>{it.title}</span>
              <button onClick={() => setItems(ls => ls.filter(i => i.id !== it.id))} className="text-slate-400 hover:text-slate-200">
                ×
              </button>
            </div>
            {it.message && <div className="mt-0.5 text-slate-300 leading-snug whitespace-pre-wrap break-words">{it.message}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const notifications = {
  show: opts => {
    try {
      const ctx = window.__toastCtx;
      if (ctx) {
        ctx.push(opts);
        return;
      }
      console.log(`[notify:${opts.color}] ${opts.title} - ${opts.message}`);
    } catch {}
  }
};

export function ToastBridge() {
  const ctx = useContext(ToastContext);
  useEffect(() => {
    window.__toastCtx = ctx;
    return () => {
      if (window.__toastCtx === ctx) delete window.__toastCtx;
    };
  }, [ctx]);
  return null;
}
