(async () => {
    // CONFIGURATION
    // Base URL for fetching historical data
    const baseHistoryUrl = 'https://backendbtc-production.up.railway.app/history';
    // Ably API Key for real-time updates
    const ablyKey = '3p_6tA.5-L0UA:wBCfc8CPkfWL3ynQ9nW83979jQ7Fo1ixo0Bcks9f8rM';
    // Number of candles to display in the chart window
    const WINDOW_SIZE = 50;
    // URL for fetching trade suggestions
    const suggestionUrl = `https://web-production-0283.up.railway.app/predict`;

    // DOM ELEMENTS
    const timeframeSelect = document.getElementById('timeframeSelect');
    const priceDisplay = document.getElementById('priceDisplay');
    const actionEl = document.getElementById('action');
    const slEl = document.getElementById('sl');
    const tpEl = document.getElementById('tp');
    const timeEl = document.getElementById('timeEl');
    const predictionInfo = document.getElementById('predictionInfo');
    const refreshPredictionBtn = document.getElementById('refreshPredictionBtn');
    const refreshPredictionText = document.getElementById('refreshPredictionText');
    const refreshPredictionSpinner = document.getElementById('refreshPredictionSpinner');

    let currentIntervalMs = 3600 * 1000;
    let lastPrice = 0;
    let currentCandleCloseTime = 0;

    let suggestionIntervalId;
    let chartUpdateIntervalId;

    // Event listener to remove animation classes after they finish
    priceDisplay.addEventListener('animationend', () => {
        priceDisplay.classList.remove('price-up-animate', 'price-down-animate');
    });

    // Custom Chart.js plugin to draw the current price line and countdown label
    const currentPriceAxisLabel = {
        id: 'currentPriceAxisLabel',
        afterDraw: (chart) => {
            const { ctx, scales: { y }, chartArea } = chart;
            const annotation = chart.options.plugins.annotation.annotations.currentPriceLine;
            const yValue = annotation.value;

            if (yValue === 0) return;

            const yCoord = y.getPixelForValue(yValue);

            if (yCoord < chartArea.top || yCoord > chartArea.bottom) {
                return;
            }

            const priceString = yValue.toFixed(2);
            const timeLeftMs = currentCandleCloseTime - Date.now();
            let countdownString = '';

            if (timeLeftMs >= 0) {
                const totalSeconds = Math.floor(timeLeftMs / 1000);
                const seconds = totalSeconds % 60;
                const totalMinutes = Math.floor(totalSeconds / 60);
                const minutes = totalMinutes % 60;
                const totalHours = Math.floor(totalMinutes / 60);
                
                if (currentIntervalMs >= 24 * 60 * 60 * 1000) {
                    const hours = totalHours % 24;
                    const days = Math.floor(totalHours / 24);
                    countdownString = `${days}d ${hours.toString().padStart(2, '0')}h`;
                } 
                else if (currentIntervalMs >= 60 * 60 * 1000) {
                    countdownString = `${totalHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                } 
                else {
                    countdownString = `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }
            }

            ctx.save();
            
            const backgroundColor = 'rgba(255, 82, 82, 0.9)';
            ctx.fillStyle = backgroundColor;
            
            ctx.font = '12px Inter, sans-serif';
            const priceMetrics = ctx.measureText(priceString);
            const countdownMetrics = ctx.measureText(countdownString);
            const boxWidth = Math.max(priceMetrics.width, countdownMetrics.width) + 12;
            const boxHeight = 36;

            ctx.fillRect(chartArea.right, yCoord - boxHeight / 2, boxWidth, boxHeight);

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const priceY = yCoord - 8;
            const countdownY = yCoord + 8;

            ctx.fillText(priceString, chartArea.right + boxWidth / 2, priceY);
            if (countdownString) {
                ctx.fillText(countdownString, chartArea.right + boxWidth / 2, countdownY);
            }

            ctx.restore();
        }
    };

    // CHART SETUP
    const ctx = document.getElementById('priceChart').getContext('2d');
    const chart = new Chart(ctx, {
        type: 'candlestick',
        data: { datasets: [{ label: 'BTC/USD', data: [] }] },
        plugins: [currentPriceAxisLabel],
        options: {
            animation: false,
            layout: {
                padding: {
                    right: 80
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: { 
                        tooltipFormat: 'HH:mm:ss',
                        unit: 'hour'
                    },
                    grid: { display: false },
                    ticks: { color: '#bbb' },
                },
                y: {
                    position: 'right',
                    grid: { 
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }, 
                    ticks: { color: '#bbb' }
                }
            },
            plugins: {
                legend: { labels: { color: '#eee' } },
                annotation: {
                    annotations: {
                        currentPriceLine: {
                            type: 'line',
                            mode: 'horizontal',
                            scaleID: 'y',
                            value: 0,
                            borderColor: '#ef4444',
                            borderWidth: 1,
                            label: {
                                enabled: false,
                            }
                        }
                    }
                }
            }
        }
    });

    // Helper function to convert interval string to milliseconds
    function getIntervalMs(intervalString) {
        const unit = intervalString.slice(-1);
        const value = parseInt(intervalString.slice(0, -1), 10);
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            case 'M': return value * 30 * 24 * 60 * 60 * 1000;
            default: return 60 * 60 * 1000;
        }
    }

    // Helper function to get Chart.js time unit
    function getChartUnit(intervalString) {
        const unit = intervalString.slice(-1);
        if (unit === 'm') return 'minute';
        if (unit === 'h') return 'hour';
        if (unit === 'd') return 'day';
        if (unit === 'w') return 'week';
        if (unit === 'M') return 'month';
        return 'hour';
    }

    // Function to update chart X-axis bounds
    function updateChartBounds(chartData) {
        if (chartData.length < 2) return;

        const firstTimestamp = chartData[0].x;
        const lastTimestamp = chartData.at(-1).x;
        
        const gap = currentIntervalMs * 5; 
        const futureTimestamp = lastTimestamp + gap;

        chart.options.scales.x.min = firstTimestamp;
        chart.options.scales.x.max = futureTimestamp;
    }

    // Function to load historical data based on selected interval
    async function loadHistory(interval) {
        try {
            const resp = await fetch(`${baseHistoryUrl}?interval=${interval}`);
            const past = await resp.json();
            const candleData = past.map(r => ({
                x: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4]
            }));
            const start = Math.max(0, candleData.length - WINDOW_SIZE);
            const view = candleData.slice(start);
            chart.data.datasets[0].data = view;
            
            if (view.length) {
                const lastCandle = view.at(-1);
                const currentPrice = lastCandle.c;
                priceDisplay.textContent = `$${currentPrice.toFixed(2)}`;
                lastPrice = currentPrice;
                chart.options.plugins.annotation.annotations.currentPriceLine.value = currentPrice;
                currentCandleCloseTime = lastCandle.x + getIntervalMs(interval);
                updateChartBounds(view);
            }
            chart.update('none');
        } catch (err) {
            console.error('History load failed:', err);
        }
    }

    // Function to fetch and update trade suggestions
    async function updateSuggestion() {
        // Show spinner and disable button
        refreshPredictionText.classList.add('hidden');
        refreshPredictionSpinner.classList.remove('hidden');
        refreshPredictionBtn.disabled = true;

        try {
            const response = await fetch(suggestionUrl, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            const j = await response.json();
            
            actionEl.textContent = j.action;
            if (j.action === 'BUY') {
                actionEl.classList.remove('text-red-400', 'text-yellow-400');
                actionEl.classList.add('text-green-400');
            } else if (j.action === 'SELL') {
                actionEl.classList.remove('text-green-400', 'text-yellow-400');
                actionEl.classList.add('text-red-400');
            } else {
                actionEl.classList.remove('text-green-400', 'text-red-400');
                actionEl.classList.add('text-yellow-400');
            }

            slEl.textContent = j.stop_loss ? `$${j.stop_loss.toFixed(2)}` : '—';
            tpEl.textContent = j.take_profit ? `$${j.take_profit.toFixed(2)}` : '—';
            
            if (timeEl) {
                timeEl.textContent = j.time;
            }
        } catch (err) {
            console.error("Failed to fetch suggestion:", err);
            actionEl.textContent = 'Error';
            actionEl.classList.remove('text-green-400', 'text-red-400');
            actionEl.classList.add('text-yellow-400');
            slEl.textContent = '—';
            tpEl.textContent = '—';
            if (timeEl) {
                timeEl.textContent = '—';
            }
        } finally {
            // Hide spinner and enable button
            refreshPredictionText.classList.remove('hidden');
            refreshPredictionSpinner.classList.add('hidden');
            refreshPredictionBtn.disabled = false;
        }
    }

    // Function to start all dashboard updates
    function startDashboardUpdates() {
        // Clear any existing intervals to prevent duplicates
        if (suggestionIntervalId) clearInterval(suggestionIntervalId);
        if (chartUpdateIntervalId) clearInterval(chartUpdateIntervalId);

        // Initial load of history for the current timeframe
        const currentInterval = timeframeSelect.value;
        loadHistory(currentInterval);

        // Start periodic updates for suggestions
        updateSuggestion(); // Initial call
        suggestionIntervalId = setInterval(updateSuggestion, 60_000); // Update every 60 seconds

        // Start periodic chart redraw for countdown and current price line
        chartUpdateIntervalId = setInterval(() => {
            if (chart.data.datasets[0].data.length > 0) {
                chart.update('none');
            }
        }, 1000); // Update every second
    }

    // Event listener for timeframe selection change
    timeframeSelect.addEventListener('change', () => {
        const newInterval = timeframeSelect.value;
        currentIntervalMs = getIntervalMs(newInterval);
        chart.options.scales.x.time.unit = getChartUnit(newInterval);
        // When timeframe changes, restart all updates
        startDashboardUpdates();
    });
    
    // Initial start of all dashboard updates when the page loads
    startDashboardUpdates();

    // Event listener for "Refresh Prediction" button
    refreshPredictionBtn.addEventListener('click', () => {
        updateSuggestion(); // Directly call updateSuggestion to refresh prediction
    });

    // Ably Realtime setup for live price updates (this runs independently)
    const ably = new Ably.Realtime(ablyKey);
    const channel = ably.channels.get('btc-ticks');
    channel.subscribe(msg => {
        const candle = JSON.parse(msg.data);
        const price = +candle.close;
        const time = +candle.startTime;

        if (isNaN(price)) return;

        priceDisplay.textContent = `$${price.toFixed(2)}`;
        
        if (price > lastPrice) {
            priceDisplay.classList.add('price-up');
            priceDisplay.classList.remove('price-down');
            priceDisplay.classList.add('price-up-animate');
        } else if (price < lastPrice) {
            priceDisplay.classList.add('price-down');
            priceDisplay.classList.remove('price-up');
            priceDisplay.classList.add('price-down-animate');
        }
        lastPrice = price;

        const data = chart.data.datasets[0].data;
        if (data.length === 0) return;

        const bucketStartTime = Math.floor(time / currentIntervalMs) * currentIntervalMs;
        const bucketCloseTime = bucketStartTime + currentIntervalMs;
        
        currentCandleCloseTime = bucketCloseTime;

        const lastChartCandle = data.at(-1);

        if (lastChartCandle.x === bucketStartTime) {
            lastChartCandle.h = Math.max(lastChartCandle.h, price);
            lastChartCandle.l = Math.min(lastChartCandle.l, price);
            lastChartCandle.c = price;
        } else {
            const newChartCandle = {
                x: bucketStartTime,
                o: price,
                h: price,
                l: price,
                c: price
            };
            data.push(newChartCandle);
            if (data.length > WINDOW_SIZE) {
                data.shift();
            }
        }
        
        chart.options.plugins.annotation.annotations.currentPriceLine.value = price;
        updateChartBounds(data);
    });
})();
