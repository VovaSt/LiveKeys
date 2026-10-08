import { Component, ElementRef, afterNextRender, signal, viewChild } from '@angular/core';

const storageKey = 'livekeys-tutorial-v1';

@Component({
  selector: 'app-tutorial', standalone: true,
  template: `
    <dialog #dialog class="tutorial-dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-text" (close)="remember()">
      <div class="dialog-heading">
        <small>Знайомство з LiveKeys · {{ step() + 1 }}/3</small>
        <button class="icon-button" aria-label="Закрити туторіал" (click)="finish()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      <div aria-live="polite">
        <h2 id="tutorial-title">{{ steps[step()]!.title }}</h2>
        <p id="tutorial-text">{{ steps[step()]!.text }}</p>
      </div>
      <div class="tutorial-actions">
        <button (click)="finish()">Пропустити</button>
        <span></span>
        @if (step() > 0) { <button (click)="step.set(step() - 1)">Назад</button> }
        <button class="primary" (click)="next()">{{ step() === 2 ? 'Почати грати' : 'Далі' }}</button>
      </div>
      <p class="small">Цю підказку можна знову відкрити в налаштуваннях.</p>
    </dialog>
  `,
  styles: [`
    .tutorial-dialog{width:min(430px,calc(100vw - 32px));box-sizing:border-box}
    h2{margin:16px 0 10px;font-size:22px}
    #tutorial-text{line-height:1.6;min-height:100px}
    .tutorial-actions{display:flex;gap:8px;align-items:center;margin-top:20px}
    .tutorial-actions span{flex:1}
    .small{margin-bottom:0}
  `]
})
export class TutorialComponent {
  readonly step = signal(0);
  readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly steps = [
    { title: '1. Увімкни звук', text: 'Натисни «Увімкнути звук» у шапці й дочекайся завантаження семплів. Грай на екранній клавіатурі або відкрий MIDI, дозволь доступ і вибери свою клавіатуру.' },
    { title: '2. Обери свій звук', text: 'Вибери готовий пресет угорі. Він поєднує до чотирьох інструментів. Стрілки біля тембру перемикають звуки, а смуги над клавіатурою показують діапазони шарів і плавні краї.' },
    { title: '3. Налаштуй і грай', text: 'Регулюй загальну гучність у шапці, а гучність шарів та ефекти — в їхніх картках. «Зберегти як» створить власний пресет. Якщо звук зависне, натисни Panic — він зупинить усі ноти.' }
  ];
  constructor() {
    afterNextRender(() => {
      try { if (localStorage.getItem(storageKey) === 'done') return; } catch { /* Storage may be unavailable. */ }
      this.open();
    });
  }
  open(): void { this.step.set(0); this.dialog().nativeElement.showModal(); }
  next(): void { if (this.step() === 2) this.finish(); else this.step.update(value => value + 1); }
  finish(): void { this.dialog().nativeElement.close(); }
  remember(): void { try { localStorage.setItem(storageKey, 'done'); } catch { /* Tutorial still closes without storage. */ } }
}
