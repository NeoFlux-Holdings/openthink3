/* Reusable sun/moon segmented toggle. Used in marketing nav, app sidebar
 * footer, and Settings → Appearance — they all stay in lock-step because they
 * share the same theme module. */
import { Icon } from './Icon';
import { useTheme } from './theme';

interface Props {
  size?: 'sm' | 'md';
  className?: string;
}

export function ThemeToggle({ size = 'sm', className = '' }: Props) {
  const [theme, setTheme] = useTheme();
  const dim = size === 'sm' ? 22 : 28;
  const ic = size === 'sm' ? 13 : 15;
  return (
    <div className={`theme-toggle ${className}`} role="group" aria-label="Theme">
      <button
        type="button"
        className={theme === 'light' ? 'on' : ''}
        onClick={() => setTheme('light')}
        title="Light"
        aria-label="Light theme"
        aria-pressed={theme === 'light'}
        style={{ width: dim, height: dim }}
      >
        <Icon name="sun" size={ic} />
      </button>
      <button
        type="button"
        className={theme === 'dark' ? 'on' : ''}
        onClick={() => setTheme('dark')}
        title="Dark"
        aria-label="Dark theme"
        aria-pressed={theme === 'dark'}
        style={{ width: dim, height: dim }}
      >
        <Icon name="moon" size={ic} />
      </button>
    </div>
  );
}
