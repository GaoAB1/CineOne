/** Tailwind 主题扩展：全部映射设计令牌 CSS 变量，禁止在组件内硬编码色值 */
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        app: 'var(--color-bg-primary)',
        surface: 'var(--color-bg-secondary)',
        card: 'var(--color-bg-card)',
        accent: 'var(--color-accent)',
        danger: 'var(--color-danger)',
        success: 'var(--color-success)',
        txt: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        line: 'var(--border-light)',
        lineStrong: 'var(--border-strong)',
        navbg: 'var(--nav-bg)',
        elevated: 'var(--color-bg-elevated)',
        warm: 'var(--surface-warm)',
      },
      fontFamily: {
        sans: ['var(--font-system)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        card: 'var(--radius-card)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        spring: 'var(--ease-spring)',
      },
    },
  },
  plugins: [],
} satisfies Config;
