// Exchange rate service using a free API
// Using exchangerate-api.com (free tier: 1500 requests/month)

const EXCHANGE_RATE_API = 'https://api.exchangerate-api.com/v4/latest/';

// Cache for exchange rates (valid for 1 hour)
const rateCache = new Map();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

export const exchangeRateService = {
    async getExchangeRate(fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) {
            return 1;
        }

        const cacheKey = `${fromCurrency}_${toCurrency}`;
        const cached = rateCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.rate;
        }

        try {
            const response = await fetch(`${EXCHANGE_RATE_API}${fromCurrency}`);
            if (!response.ok) {
                throw new Error('Failed to fetch exchange rate');
            }
            
            const data = await response.json();
            const rate = data.rates[toCurrency];
            
            if (!rate) {
                throw new Error(`Exchange rate not found for ${toCurrency}`);
            }

            // Cache the rate
            rateCache.set(cacheKey, {
                rate,
                timestamp: Date.now()
            });

            return rate;
        } catch (error) {
            console.error('Error fetching exchange rate:', error);
            // Return 1 as fallback (no conversion)
            return 1;
        }
    },

    async convertAmount(amount, fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) {
            return amount;
        }

        const rate = await this.getExchangeRate(fromCurrency, toCurrency);
        return amount * rate;
    },

    clearCache() {
        rateCache.clear();
    }
};

