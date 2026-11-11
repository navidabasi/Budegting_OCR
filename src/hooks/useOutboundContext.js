import { useEffect } from 'react';
import { useAccounts, useTrips } from '../data/hooks';
import { usePeople } from './usePeople';
import { setOutboundContext } from '../services/aiOutbound';

/** Tells the AI boundary (services/aiOutbound.js) which names are people/accounts/trips on this device so it can remove them. */
export function useOutboundContext() {
    const { people } = usePeople();
    const { accounts } = useAccounts();
    const { trips } = useTrips();
    useEffect(() => {
        setOutboundContext({ people, accounts, trips });
    }, [people, accounts, trips]);
}
