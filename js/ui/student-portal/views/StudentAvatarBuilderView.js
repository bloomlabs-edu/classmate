/**
 * ui/student-portal/views/StudentAvatarBuilderView.js
 *
 * The avatar builder — reached from Profile's "Customize Avatar"
 * action, never inserted into onboarding (see the explicit decision
 * to keep the join flow frictionless: every student starts with
 * DEFAULT_AVATAR_CONFIG and can come here whenever they like).
 *
 * Phase 1: "Save" writes to this device's localStorage only, via
 * services/avatarConfigService.js. There is no Firestore write here
 * at all yet — see that file's doc comment for why, and for what
 * Phase 2 will add on top of this same function without needing to
 * change this screen.
 */

import {
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_COLORS,
  EXPRESSIONS,
  GLASSES_OPTIONS,
  ACCESSORY_OPTIONS,
  DEFAULT_AVATAR_CONFIG,
} from '../../../config/avatarOptions.js';
import { createAvatarSvgElement } from '../../../utils/avatarRenderer.js';
import { getAvatarConfigOrDefault, saveAvatarConfig } from '../../../services/avatarConfigService.js';
import { showToast } from '../../components/Toast.js';
import { createBackButton } from '../../components/BackButton.js';

function randomOption(options) {
  return options[Math.floor(Math.random() * options.length)].id;
}

export function renderStudentAvatarBuilderView(container, { studentId, onBack }) {
  container.innerHTML = '';

  let config = { ...getAvatarConfigOrDefault(studentId) };

  const wrapper = document.createElement('div');
  wrapper.className = 'avatar-builder';

  const header = document.createElement('div');
  header.className = 'avatar-builder__header';
  const backButton = createBackButton(onBack);
  header.appendChild(backButton);
  wrapper.appendChild(header);

  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = 'Customize Your Avatar';
  wrapper.appendChild(title);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'avatar-builder__preview';
  wrapper.appendChild(previewWrap);

  function renderPreview() {
    previewWrap.innerHTML = '';
    previewWrap.appendChild(createAvatarSvgElement(config, { size: 160 }));
  }
  renderPreview();

  const actionsRow = document.createElement('div');
  actionsRow.className = 'avatar-builder__actions-row';

  const surpriseButton = document.createElement('button');
  surpriseButton.type = 'button';
  surpriseButton.className = 'btn btn--ghost';
  surpriseButton.textContent = '\ud83c\udfb2 Surprise Me!';
  surpriseButton.addEventListener('click', () => {
    config = {
      skinTone: randomOption(SKIN_TONES),
      hairStyle: randomOption(HAIR_STYLES),
      hairColor: randomOption(HAIR_COLORS),
      expression: randomOption(EXPRESSIONS),
      glasses: randomOption(GLASSES_OPTIONS),
      accessory: randomOption(ACCESSORY_OPTIONS),
    };
    renderPreview();
    syncControlSelections();
  });
  actionsRow.appendChild(surpriseButton);
  wrapper.appendChild(actionsRow);

  const sections = document.createElement('div');
  sections.className = 'avatar-builder__sections';
  wrapper.appendChild(sections);

  const controlGroups = [];

  function addOptionSection({ title: sectionTitle, key, options, swatch }) {
    const section = document.createElement('div');
    section.className = 'avatar-builder__section';

    const heading = document.createElement('h2');
    heading.className = 'avatar-builder__section-title';
    heading.textContent = sectionTitle;
    section.appendChild(heading);

    const row = document.createElement('div');
    row.className = 'avatar-builder__option-row';

    const buttons = options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-builder__option';
      button.setAttribute('aria-label', option.label);
      button.title = option.label;

      if (swatch) {
        const swatchEl = document.createElement('span');
        swatchEl.className = 'avatar-builder__option-swatch';
        swatchEl.style.backgroundColor = option.hex;
        button.appendChild(swatchEl);
      } else {
        const labelEl = document.createElement('span');
        labelEl.className = 'avatar-builder__option-label';
        labelEl.textContent = option.label;
        button.appendChild(labelEl);
      }

      button.addEventListener('click', () => {
        config = { ...config, [key]: option.id };
        renderPreview();
        updateSelected();
      });

      row.appendChild(button);
      return { button, id: option.id };
    });

    function updateSelected() {
      buttons.forEach(({ button, id }) => {
        button.classList.toggle('avatar-builder__option--selected', config[key] === id);
      });
    }
    updateSelected();

    section.appendChild(row);
    sections.appendChild(section);
    controlGroups.push(updateSelected);
  }

  function syncControlSelections() {
    controlGroups.forEach((update) => update());
  }

  addOptionSection({ title: 'Skin Tone', key: 'skinTone', options: SKIN_TONES, swatch: true });
  addOptionSection({ title: 'Hair Style', key: 'hairStyle', options: HAIR_STYLES });
  addOptionSection({ title: 'Hair Color', key: 'hairColor', options: HAIR_COLORS, swatch: true });
  addOptionSection({ title: 'Expression', key: 'expression', options: EXPRESSIONS });
  addOptionSection({ title: 'Glasses', key: 'glasses', options: GLASSES_OPTIONS });
  addOptionSection({ title: 'Accessory', key: 'accessory', options: ACCESSORY_OPTIONS });

  const footer = document.createElement('div');
  footer.className = 'avatar-builder__footer';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--ghost';
  resetButton.textContent = 'Reset to Default';
  resetButton.addEventListener('click', () => {
    config = { ...DEFAULT_AVATAR_CONFIG };
    renderPreview();
    syncControlSelections();
  });

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.textContent = 'Save Avatar';
  saveButton.addEventListener('click', () => {
    // Phase 1: local-only (see avatarConfigService.js's doc comment).
    // Saving never fails in a way the student needs to see — a full
    // storage quota or private-browsing restriction is rare and not
    // something a young student can act on; the avatar still displays
    // correctly for the rest of this session either way.
    saveAvatarConfig(studentId, config);
    showToast('Avatar saved!');
    onBack();
  });

  footer.append(resetButton, saveButton);
  wrapper.appendChild(footer);

  container.appendChild(wrapper);
}
