(async () => {
  // CONFIG
  const baseHistoryUrl = 'https://backendbtc-production.up.railway.app/history';
  const ablyKey        = '3p_6tA.5-L0UA:wBCfc8CPkfWL3ynQ9nW83979jQ7Fo1ixo0Bcks9f8rM';
  const WINDOW_SIZE    = 50;
  const suggestionUrl  = `https://web-production-0283.up.railway.app/predict`;

  // ELEMENTS
  const timeframeSelect = document.getElementById('timeframeSelect');
  const priceDisplay    = document.getElementById('priceDisplay');
  const actionEl        = document.getElementById('action');
  const slEl            = document.getElementById('sl');
  const tpEl            = document.getElementById('tp');

  let currentIntervalMs = 3600 * 1000;
  let lastPrice = 0;
  let currentCandleCloseTime = 0;

  // --- ADD: Event listener to clean up animation classes after they finish ---
  priceDisplay.addEventListener('animationend', () => {
    priceDisplay.classList.remove('price-up-animate', 'price-down-animate');
  });

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
      
      ctx.font = '12px sans-serif';
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
                grid: { borderColor: 'rgba(255, 255, 255, 0.1)' },
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
                        borderColor: 'rgba(255, 82, 82, 0.7)',
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

  function getChartUnit(intervalString) {
    const unit = intervalString.slice(-1);
    if (unit === 'm') return 'minute';
    if (unit === 'h') return 'hour';
    if (unit === 'd') return 'day';
    if (unit === 'w') return 'week';
    if (unit === 'M') return 'month';
    return 'hour';
  }

  function updateChartBounds(chartData) {
      if (chartData.length < 2) return;

      const firstTimestamp = chartData[0].x;
      const lastTimestamp = chartData.at(-1).x;
      
      const gap = currentIntervalMs * 5;
      const futureTimestamp = lastTimestamp + gap;

      chart.options.scales.x.min = firstTimestamp;
      chart.options.scales.x.max = futureTimestamp;
  }

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

  timeframeSelect.addEventListener('change', () => {
    const newInterval = timeframeSelect.value;
    currentIntervalMs = getIntervalMs(newInterval);
    chart.options.scales.x.time.unit = getChartUnit(newInterval);
    loadHistory(newInterval);
  });
  
  const initialInterval = timeframeSelect.value;
  chart.options.scales.x.time.unit = getChartUnit(initialInterval);
  currentIntervalMs = getIntervalMs(initialInterval);
  loadHistory(initialInterval);

  const ably = new Ably.Realtime(ablyKey);
  const channel = ably.channels.get('btc-ticks');
  channel.subscribe(msg => {
    const candle = JSON.parse(msg.data);
    const price = +candle.close;
    const time = +candle.startTime;

    if (isNaN(price)) return;

    priceDisplay.textContent = `$${price.toFixed(2)}`;
    
    // --- UPDATE: Logic to trigger the blinking animation ---
    if (price > lastPrice) {
      priceDisplay.classList.add('price-up');
      priceDisplay.classList.remove('price-down');
      // Add animation class, which will be removed by the 'animationend' listener
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

  async function updateSuggestion() {
  try {
    const response = await fetch(suggestionUrl, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const j = await response.json();
    
    // Mapping action, stop_loss, and take_profit as before
    actionEl.textContent = j.action;
    slEl.textContent = j.stop_loss ? `$${j.stop_loss.toFixed(2)}` : '—';
    tpEl.textContent = j.take_profit ? `$${j.take_profit.toFixed(2)}` : '—';
    
    // Directly mapping time as a string
    const timeEl = document.getElementById('timeEl');  // Ensure you have an element with id="timeEl"
    if (timeEl) {
      timeEl.textContent = j.time;  // Directly map the time string
    }
  } catch (err) {
    console.error("Failed to fetch suggestion:", err);
    actionEl.textContent = 'Error';
    slEl.textContent = '—';
    tpEl.textContent = '—';
    const timeEl = document.getElementById('timeEl');  // Ensure it's also handled in case of error
    if (timeEl) {
      timeEl.textContent = '—';
    }
  }
}
  
  updateSuggestion();
  setInterval(updateSuggestion, 60_000);

  setInterval(() => {
    if (chart.data.datasets[0].data.length > 0) {
      chart.update('none');
    }
  }, 1000);

})();
