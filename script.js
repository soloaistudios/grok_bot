const range = document.getElementById('depositRange');
const depositValue = document.getElementById('depositValue');
const balanceValue = document.getElementById('balanceValue');
const monthValue = document.getElementById('monthValue');
const dayValue = document.getElementById('dayValue');

function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function updateCalculator() {
  const deposit = Number(range.value);
  const progress = ((deposit - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
  range.style.setProperty('--progress', `${Math.max(progress, 1.8)}%`);

  // Screenshot reference uses $500 → $950 as the default visual state.
  // This keeps the same 90% projection while allowing the control to move.
  const projected = deposit * 1.9;
  const profit = projected - deposit;
  const perDay = profit / 30;

  depositValue.textContent = Math.round(deposit).toLocaleString('en-US');
  balanceValue.textContent = money(projected);
  monthValue.textContent = '+' + money(profit).slice(1);
  dayValue.textContent = '+' + money(perDay).slice(1);
}

range.addEventListener('input', updateCalculator);
updateCalculator();

// Reuse one set of bars so the chart looks crisp at every viewport size.
const chart = document.getElementById('barChart');
const heights = [29, 24, 27, 28, 31, 36, 31, 33, 39, 42, 37, 46, 41, 49, 44, 47, 51, 43, 48, 46, 54, 49, 51, 45, 56, 50, 58, 52, 46, 61, 66, 58];
heights.forEach((height, index) => {
  const bar = document.createElement('span');
  bar.style.height = `${height + (index % 3) * 2}px`;
  if (index === heights.length - 1) bar.classList.add('highlight');
  chart.appendChild(bar);
});

// Accessible, keyboard-friendly plan tabs.
document.querySelectorAll('.segment').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.segment').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  });
});

// Smooth in-page navigation with a small sticky-header offset.
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', event => {
    const id = link.getAttribute('href');
    const target = document.querySelector(id);
    if (!target) return;
    event.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 78;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
