import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { focusPageHeading, shouldResetView } from '../lib/routeFocus';

/** Montado uma vez dentro do BrowserRouter (App.tsx). */
export default function RouteFocus() {
    const { pathname } = useLocation();
    const navigationType = useNavigationType();
    const previousPath = useRef<string | null>(null);

    useEffect(() => {
        const previous = previousPath.current;
        previousPath.current = pathname;
        if (!shouldResetView(navigationType, previous, pathname)) return;
        window.scrollTo(0, 0);
        return focusPageHeading();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- só a troca de caminho importa
    }, [pathname]);

    return null;
}
