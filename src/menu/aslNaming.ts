import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { WebXRHandJoint, type WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import {
  aslNamingEnabled, aslNamingHand, aslNamingTarget, aslTrainingLetter, aslRecordLetter,
  aslAcceptLetter, aslNameText, aslNamingStatus, aslNameBackspace, aslNameSpace, aslApplyName,
  aslLetterReference, aslTrainedLetters, aslLetterImage,
} from '../ui/dom';
import { FingerspellingTemplates, type LetterMatch } from '../interaction/fingerspelling';
import { getObjectName, setObjectName } from '../interaction/objectNames';
import { createASLNamingPanel, type NamingAction } from './aslNamingPanel';
import { ASL_SYMBOLS, getASLLetterImage, getASLLetterReference } from './aslAlphabet';

let tracking: WebXRHandTracking | null = null;
export function setNamingHandTracking(value: WebXRHandTracking | null) { tracking = value; }
export function isFingerspellingNamingActive() { return !!aslNamingEnabled?.checked; }
let namingAction: ((command: NamingAction) => void) | null = null;
export function executeASLNamingAction(command: NamingAction) { namingAction?.(command); }

export function initASLNaming(getSelected: () => TransformNode | null, prepare: () => void) {
  const templates = new FingerspellingTemplates();
  let samples: number[][] = [];
  let recording: { letter: string; frames: number[][] } | null = null;
  let candidate: LetterMatch | null = null;
  let sampleTime = 0;
  let target: TransformNode | null = null;
  const view = createASLNamingPanel();
  let message = '';
  let confirmationPinch = false;
  if (aslTrainingLetter) {
    aslTrainingLetter.replaceChildren(...ASL_SYMBOLS.map(entry => {
      const option = document.createElement('option');
      option.value = entry.letter;
      option.textContent = `${entry.letter} - ${/^[0-9]$/.test(entry.letter) ? 'Number handshape' : entry.motion ? 'Motion' : 'Held handshape'}`;
      return option;
    }));
  }
  function refreshReference() {
    const entry = getASLLetterReference(aslTrainingLetter?.value ?? 'A');
    const image = entry ? getASLLetterImage(entry.letter) : undefined;
    if (aslLetterImage && image) {
      if (aslLetterImage.getAttribute('src') !== image) aslLetterImage.src = image;
      aslLetterImage.alt = `ASL ${entry && /^[0-9]$/.test(entry.letter) ? 'number' : 'letter'} ${entry?.letter} ${entry?.motion ? 'motion illustration' : 'handshape'}`;
    }
    if (aslLetterReference) aslLetterReference.textContent = entry
      ? `${entry.letter} - ${entry.motion ? 'Motion letter' : 'Held handshape'}: ${entry.description}` : 'Select a letter A-Z.';
    if (aslTrainedLetters) aslTrainedLetters.textContent = `Taught signs (${templates.size}/${ASL_SYMBOLS.length}): ${templates.letters || 'none'}`;
    view.update(aslNameText?.value ?? '', aslTrainingLetter?.value ?? 'A', message, templates.letters);
  }
  const status = (text: string) => {
    message = text;
    if (aslNamingStatus) aslNamingStatus.textContent = text;
    refreshReference();
  };
  function reset() {
    samples = []; recording = null; candidate = null;
    if (aslAcceptLetter) aslAcceptLetter.disabled = true;
  }
  function chooseTarget() {
    target = aslNamingTarget?.value === 'wire' ? scene.getTransformNodeByName('fieldTool-wire') : getSelected();
    if (aslNameText) aslNameText.value = target ? getObjectName(target) ?? '' : '';
    reset();
    status(target ? 'Name target selected. Teach letters, then sign and accept one at a time.' : 'Select a marcher before enabling naming.');
  }
  aslTrainingLetter?.addEventListener('change', () => {
    reset();
    status(`Ready to record ${aslTrainingLetter?.value ?? 'A'}.`);
  });
  aslNameText?.addEventListener('input', refreshReference);
  aslLetterImage?.addEventListener('error', () => {
    status('Hand-letter image could not be loaded. The text reference is still available.');
  });
  aslNamingEnabled?.addEventListener('change', () => {
    reset();
    if (isFingerspellingNamingActive()) { prepare(); chooseTarget(); view.show(); }
    else { view.hide(); status('Fingerspelling input off.'); }
  });
  aslNamingTarget?.addEventListener('change', chooseTarget);
  aslNamingHand?.addEventListener('change', () => {
    reset(); templates.clear(); status('Signing hand changed. Teach at least two signs for this hand.');
  });
  aslRecordLetter?.addEventListener('click', () => {
    if (!isFingerspellingNamingActive()) { status('Enable fingerspelling input first.'); return; }
    const letter = aslTrainingLetter?.value.toUpperCase().trim() ?? '';
    if (!/^[A-Z0-9]$/.test(letter)) { status('Choose one letter A-Z or digit 0-9 to teach.'); return; }
    if (!tracking?.getHandByHandedness(aslNamingHand?.value === 'left' ? 'left' : 'right')) {
      status('Signing hand is not tracked. Use Quest hand tracking or type the name instead.');
      return;
    }
    reset(); recording = { letter, frames: [] };
    status(`Recording ${letter}: hold the sign or perform its full motion now.`);
  });
  aslAcceptLetter?.addEventListener('click', () => {
    if (!candidate || !aslNameText || !isFingerspellingNamingActive()) return;
    if (aslNameText.value.length >= 40) { status('Name limit reached (40 characters).'); return; }
    aslNameText.value += candidate.letter;
    reset(); status('Letter accepted. Sign the next letter; repeated letters require another acceptance.');
  });
  aslNameBackspace?.addEventListener('click', () => {
    if (aslNameText) aslNameText.value = aslNameText.value.slice(0, -1);
  });
  aslNameSpace?.addEventListener('click', () => {
    if (aslNameText && aslNameText.value.length < 40) aslNameText.value += ' ';
  });
  aslApplyName?.addEventListener('click', () => {
    target ??= aslNamingTarget?.value === 'wire' ? scene.getTransformNodeByName('fieldTool-wire') : getSelected();
    if (!target || target.isDisposed()) { status('Name target no longer exists. Select a target again.'); return; }
    if (!setObjectName(target, aslNameText?.value ?? '')) { status('Enter a nonempty name of at most 40 characters.'); return; }
    status(`Named: ${getObjectName(target)}. Names last until reload or object deletion.`);
  });
  namingAction = command => {
    if (command === 'toggle' && aslNamingEnabled) {
      aslNamingEnabled.checked = !aslNamingEnabled.checked;
      aslNamingEnabled.dispatchEvent(new Event('change'));
      return;
    }
    if (!isFingerspellingNamingActive()) return;
    if (command === 'previous' || command === 'next') {
      if (!aslTrainingLetter) return;
      const selectedSymbol = aslTrainingLetter.value;
      const value = Math.max(0, ASL_SYMBOLS.findIndex(entry => entry.letter === selectedSymbol));
      aslTrainingLetter.value = ASL_SYMBOLS[(value + (command === 'next' ? 1 : ASL_SYMBOLS.length - 1)) % ASL_SYMBOLS.length].letter;
      reset();
      status(`Ready to record ${aslTrainingLetter.value}.`);
    } else {
      const buttons = { accept: aslAcceptLetter, save: aslApplyName, backspace: aslNameBackspace, space: aslNameSpace, record: aslRecordLetter };
      if (command !== 'toggle') buttons[command]?.click();
      refreshReference();
    }
  };
  refreshReference();
  scene.onBeforeRenderObservable.add(() => {
    if (!isFingerspellingNamingActive()) return;
    const otherHand = tracking?.getHandByHandedness(aslNamingHand?.value === 'left' ? 'right' : 'left');
    if (otherHand) {
      const index = otherHand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const thumb = otherHand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      const pinched = Vector3.Distance(index, thumb) < (confirmationPinch ? 0.04 : 0.025);
      if (pinched && !confirmationPinch) {
        const hit = view.panel.buttonNear(index.add(thumb).scale(0.5));
        if (hit?.action === 'aslNaming') namingAction?.(hit.command);
      }
      confirmationPinch = pinched;
    } else confirmationPinch = false;
    if (!isFingerspellingNamingActive()) return;
    sampleTime += Math.min(0.1, scene.getEngine().getDeltaTime() / 1000);
    if (sampleTime < 0.08) return;
    sampleTime = 0;
    const hand = tracking?.getHandByHandedness(aslNamingHand?.value === 'left' ? 'left' : 'right');
    const camera = scene.activeCamera;
    if (!hand || !camera) {
      reset(); status('Signing hand is not tracked. Use Quest hand tracking or type the name instead.'); return;
    }
    const wrist = hand.getJointMesh(WebXRHandJoint.WRIST).getAbsolutePosition();
    const middle = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL).getAbsolutePosition();
    const scale = Vector3.Distance(wrist, middle);
    if (!Number.isFinite(scale) || scale < 0.03 || scale > 0.2) {
      reset(); status('Hand pose unavailable. Keep the signing hand in view.'); return;
    }
    const pose = Object.values(WebXRHandJoint).flatMap(joint => {
      const relative = hand.getJointMesh(joint).getAbsolutePosition().subtract(wrist).scale(1 / scale);
      return Vector3.TransformNormal(relative, camera.getViewMatrix()).asArray();
    });
    pose.push(...Vector3.TransformCoordinates(wrist, camera.getViewMatrix()).asArray());
    if (pose.length !== 78 || !pose.every(Number.isFinite)) {
      reset(); status('Incomplete hand joints. Keep all fingers visible.'); return;
    }
    samples.push(pose);
    if (samples.length > 15) samples.shift();
    if (recording) {
      recording.frames.push(pose);
      if (recording.frames.length >= 15) {
        const letter = recording.letter;
        if (!templates.record(letter, recording.frames)) {
          reset(); status('Recording rejected: incomplete hand sample. Please record again.'); return;
        }
        reset(); status(`Recorded ${letter}. Trained: ${templates.letters}. Teach at least two distinct letters.`);
      }
      return;
    }
    candidate = samples.length >= 15 ? templates.match(samples) : null;
    if (aslAcceptLetter) aslAcceptLetter.disabled = !candidate;
    if (candidate) status(`Candidate ${candidate.letter} (${Math.round(candidate.confidence * 100)}% similarity). Accept only if correct.`);
    else status(`No confident letter. Trained: ${templates.letters || 'none'}. Teach at least two distinct signs.`);
  });
}
