// Speeds use Box2D metres/second; arena positions and attack ranges use design pixels.
export const DEFAULT_BATTLE_RULES = Object.freeze({
    // A 90px collision diameter matches the guide; artwork and soldier scale are independent.
    width: 609, height: 973, centerX: 0, centerY: 0, tokenRadius: 45, ptm: 32,
    damping: 1.5, restitution: 0.84, wallRestitution: 0.88,
    minDrag: 12, maxDrag: 185, minSpeed: 6, maxSpeed: 40, launchMultiplier: 1.35, powerCurve: 1.35, troopScale: 0.6, tokenTroopScale: 0.4,
    roundIntroSeconds: 1, turnBannerSeconds: 0.5,
    stopSpeed: 0.12, stopAngularSpeed: 1, stopHold: 0.4, maxShotSeconds: 7,
    physicsStep: 1 / 60, combatStep: 1 / 30, combatSeconds: 45,
    actionPoints: 6, labTokenLimit: 12, spawnY: 510,
    maxLaunchAngle: 55,
    arrowFlightMultiplier: 1.5,
});

export type BattleRules = { -readonly [K in keyof typeof DEFAULT_BATTLE_RULES]: number };
