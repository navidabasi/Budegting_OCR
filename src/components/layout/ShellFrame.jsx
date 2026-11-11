import { useLocation } from 'react-router-dom';

const WIDE = ['/activity']; // lay out their own panes from tablet width
const NO_RAIL = ['/scan', '/welcome'];

/**
 * Page frame around the routes. Phone: nothing. Tablet (>= 768 px): single-column pages stay a readable column in the middle.
 * PC (>= 1100 px): room for the left nav rail. Activity and Scan lay out their own panes. Public pages are left alone.
 */
export default function ShellFrame({ authed, children }) {
    const { pathname } = useLocation();
    if (!authed) return children;
    const wide = WIDE.some((p) => pathname.startsWith(p)) || NO_RAIL.some((p) => pathname.startsWith(p));
    const rail = !NO_RAIL.some((p) => pathname.startsWith(p));
    return <div className={`${rail ? 'desk:ps-24' : ''} ${wide ? '' : 'md:mx-auto md:w-full md:max-w-[760px]'}`} data-testid="shell-frame">{children}</div>;
}
