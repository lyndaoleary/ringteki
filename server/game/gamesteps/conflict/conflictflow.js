const _ = require('underscore');
const BaseStep = require('../basestep.js');
const GamePipeline = require('../../gamepipeline.js');
const SimpleStep = require('../simplestep.js');
const ActionWindow = require('../actionwindow.js');
const InitiateConflictPrompt = require('./initiateconflictprompt.js');
const SelectDefendersPrompt = require('./selectdefendersprompt.js');

/**
Conflict Resolution
3.2 Declare Conflict
3.2.1 Declare defenders
3.2.2 CONFLICT ACTION WINDOW
    (Defender has first opportunity)
3.2.3 Compare skill values.
3.2.4 Apply unopposed.
3.2.5 Break province.
3.2.6 Resolve Ring effects.
3.2.7 Claim ring.
3.2.8 Return home. Go to (3.3).
 */

class ConflictFlow extends BaseStep {
    constructor(game, conflict) {
        super(game);
        this.conflict = conflict;
        this.pipeline = new GamePipeline();
        this.pipeline.initialise([
            new SimpleStep(this.game, () => this.resetCards()),
            new InitiateConflictPrompt(this.game, this.conflict, this.conflict.attackingPlayer),
            new SimpleStep(this.game, () => this.initiateConflict()),
            new SimpleStep(this.game, () => this.announceAttackerSkill()),
            new SimpleStep(this.game, () => this.promptForDefenders()),
            new SimpleStep(this.game, () => this.announceDefenderSkill()),
            new ActionWindow(this.game, 'Conflict Action Window', 'conflict'),
            new SimpleStep(this.game, () => this.determineWinner()),
            new SimpleStep(this.game, () => this.applyKeywords()),
            new SimpleStep(this.game, () => this.applyUnopposed()),
            new SimpleStep(this.game, () => this.checkBreakProvince()),
            new SimpleStep(this.game, () => this.resolveRingEffects()),
            new SimpleStep(this.game, () => this.claimRing()),
            new SimpleStep(this.game, () => this.returnHome()),
            new SimpleStep(this.game, () => this.completeConflict())
        ]);
    }

    resetCards() {
        this.conflict.resetCards();
    }

    initiateConflict() {
        if(this.conflict.cancelled) {
            return;
        }
        
        let events = [{
            name: 'onConflictDeclared',
            params: { conflict: this.conflict, conflictType: this.conflict.conflictType }
        }];
        
        let ring = this.game.rings[this.conflict.conflictRing];
        this.conflict.elements.push(this.conflict.conflictRing);
        this.conflict.attackingPlayer.conflicts.perform(this.conflict.conflictType);
        _.each(this.conflict.attackers, card => card.inConflict = true);
        if(ring.fate > 0) {
            events.push({
                name: 'onSelectRingWithFate',
                params: {
                    conflict: this.conflict,
                    ring: ring,
                    fate: ring.fate
                }
            });
            this.game.addFate(this.conflict.attackingPlayer, ring.fate);
            ring.removeFate();
        }

        this.game.addMessage('{0} is initiating a {1} conflict at {2}, contesting the {3} ring', this.conflict.attackingPlayer, this.conflict.conflictType, this.conflict.conflictProvince, this.conflict.conflictRing);
 
        if(!this.conflict.isSinglePlayer) {
            this.conflict.conflictProvince.inConflict = true;
            if(this.conflict.conflictProvince.facedown) {
                this.conflict.conflictProvince.facedown = false;
                events.push({
                    name: 'onProvinceRevealed',
                    params: {
                        conflict: this.conflict,
                        province: this.conflict.conflictProvince
                    }
                });
            }
        }
        this.game.raiseAtomicEvent(events);
    }

    promptForAttackers() {
        var title = 'Select conflict attackers';
        if(this.conflict.attackingPlayer.conflictrLimit !== 0) {
            title += ' (limit ' + this.conflict.attackingPlayer.conflictrLimit + ')';
        }

        this.game.promptForSelect(this.conflict.attackingPlayer, {
            numCards: this.conflict.attackingPlayer.conflictrLimit,
            multiSelect: true,
            activePromptTitle: title,
            waitingPromptTitle: 'Waiting for opponent to select attackers',
            cardCondition: card => this.allowAsAttacker(card),
            onSelect: (player, attackers) => this.chooseAttackers(player, attackers),
            onCancel: () => this.conflict.cancelConflict()
        });
    }

    allowAsAttacker(card) {
        return this.conflict.attackingPlayer === card.controller && card.canDeclareAsAttacker(this.conflict.conflictType);
    }

    chooseAttackers(player, attackers) {
        this.conflict.addAttackers(attackers);

        return true;
    }
    
    announceAttackerSkill() {
        if(this.conflict.cancelled) {
            return;
        }

        // Explicitly recalculate strength in case an effect has modified character strength.
        this.conflict.calculateSkill();
        this.game.addMessage('{0} has initiated a {1} conflict with skill {2}', this.conflict.attackingPlayer, this.conflict.conflictType, this.conflict.attackerSkill);
    }

    promptForDefenders() {
        if(this.conflict.cancelled || this.conflict.isSinglePlayer) {
            return;
        }

        this.game.queueStep(new SelectDefendersPrompt(this.game, this.conflict.defendingPlayer, this.conflict));
    }

    allowAsDefender(card) {
        return this.conflict.defendingPlayer === card.controller && card.canDeclareAsDefender(this.conflict.conflictType);
    }

    chooseDefenders(defenders) {
        this.conflict.addDefenders(defenders);

        this.game.raiseEvent('onDefendersDeclared', { conflict: this.conflict });

        return true;
    }

    announceDefenderSkill() {
        if(this.conflict.cancelled || this.conflict.isSinglePlayer) {
            return;
        }

        // Explicitly recalculate strength in case an effect has modified character strength.
        _.each(this.conflict.defenders, card => card.inConflict = true);
        this.conflict.calculateSkill();
        if(this.conflict.defenders.length > 0) {
            this.game.addMessage('{0} has defended with skill {1}', this.conflict.defendingPlayer, this.conflict.defenderSkill);
        } else {
            this.game.addMessage('{0} does not defend the conflict', this.conflict.defendingPlayer);
        }
    }

    determineWinner() {
        if(this.conflict.cancelled) {
            return;
        }
        
        if(this.game.manualMode && !this.conflict.isSinglePlayer) {
            this.game.promptWithMenu(this.conflict.attackingPlayer, this, {
                activePrompt: {
                    promptTitle: 'Conflict Result',
                    menuTitle: 'How did the conflict resolve?',
                    buttons: [
                        { text: 'Attacker Won', arg: 'attacker', method: 'manuallyDetermineWinner' },
                        { text: 'Defender Won', arg: 'defender', method: 'manuallyDetermineWinner' },
                        { text: 'No Winner', arg: 'nowinner', method: 'manuallyDetermineWinner' }
                    ]
                },
                waitingPromptTitle: 'Waiting for opponent to resolve conflict'
            });
            return;
        } 

        this.conflict.determineWinner();

        if(!this.conflict.winner && !this.conflict.loser) {
            this.game.addMessage('There is no winner or loser for this conflict because both sides have 0 skill');
        } else {
            this.game.addMessage('{0} won a {1} conflict {2} vs {3}',
                this.conflict.winner, this.conflict.conflictType, this.conflict.winnerSkill, this.conflict.loserSkill);
            this.conflict.winner.conflicts.won(this.conflict.conflictType, this.conflict.winner === this.conflict.attackingPlayer);
            this.conflict.loser.conflicts.lost(this.conflict.conflictType, this.conflict.loser === this.conflict.attackingPlayer);
        }
    }
    
    manuallyDetermineWinner(player, choice) {
        if(choice === 'attacker') {
            this.conflict.winner = player;
            this.conflict.loser = this.conflict.defendingPlayer;
        } else if(choice === 'defender') {
            this.conflict.winner = this.conflict.defendingPlayer;
            this.conflict.loser = player;
        }
        if(!this.conflict.winner && !this.conflict.loser) {
            this.game.addMessage('There is no winner or loser for this conflict because both sides have 0 skill');
        } else {
            this.game.addMessage('{0} won a {1} conflict', this.conflict.winner, this.conflict.conflictType);
            this.conflict.winner.conflicts.won(this.conflict.conflictType, this.conflict.winner === this.conflict.attackingPlayer);
            this.conflict.loser.conflicts.lost(this.conflict.conflictType, this.conflict.loser === this.conflict.attackingPlayer);
        }
        return true;
    }

    applyKeywords() {
        if(this.conflict.isAttackerTheWinner() && this.conflict.defenders.length === 0) {
            this.conflict.conflictUnopposed = true;
        }
                
        if(this.conflict.isAttackerTheWinner()) {
            _.each(this.conflict.attackers, card => {
                if(card.hasPride()) {
                    this.conflict.attackingPlayer.honorCard(card);
                }
            });
            _.each(this.conflict.defenders, card => {
                if(card.hasPride()) {
                    this.conflict.defendingPlayer.dishonorCard(card);
                }
            });
        } else if(this.conflict.winner === this.conflict.defendingPlayer) {
            _.each(this.conflict.attackers, card => {
                if(card.hasPride()) {
                    this.conflict.attackingPlayer.dishonorCard(card);
                }
            });
            _.each(this.conflict.defenders, card => {
                if(card.hasPride()) {
                    this.conflict.defendingPlayer.honorCard(card);
                }
            });
        }
        
        this.game.raiseEvent('afterConflict', { conflict: this.conflict });
    }

    applyUnopposed() {
        if(this.conflict.cancelled || this.game.manualMode) {
            return;
        }
        
        if(this.conflict.conflictUnopposed) {
            this.game.addHonor(this.conflict.loser, -1);
        }
    }
    
    checkBreakProvince() {
        if(this.conflict.cancelled || this.conflict.isSinglePlayer || this.game.manualMode) {
            return;
        }

        let province = this.conflict.conflictProvince;
        if(this.conflict.isAttackerTheWinner() && this.conflict.skillDifference >= province.getStrength()) {
            this.game.raiseEvent('onBreakProvince', { conflict: this.conflict, province: province }, province.breakProvince());
            this.game.addMessage('{0} has broken the province!', this.conflict.winner.name);
        }
    }
    
    resolveRingEffects() {
        if(this.conflict.cancelled) {
            return;
        }

        if(this.conflict.isAttackerTheWinner()) {
            let menuTitle = 'Do you want to resolve the ' + this.conflict.conflictRing + ' ring?';
            let waitingPromptTitle = 'Waiting for opponent to use decide whether to resolve the ' + this.conflict.conflictRing + ' ring';
            this.game.promptWithMenu(this.conflict.winner, this, {
                activePrompt: {
                    promptTitle: 'Resolve Ring',
                    menuTitle: menuTitle,
                    buttons: [
                        { text: 'Yes', arg: 'Yes', method: 'triggerRingResolutionEvent' },
                        { text: 'No', arg: 'No', method: 'triggerRingResolutionEvent' }
                    ]
                },
                waitingPromptTitle: waitingPromptTitle
            });
        }       
    }
    
    triggerRingResolutionEvent(player, arg) {
        if(arg !== 'No') {
            this.game.raiseEvent('onResolveRingEffects', { player: player, conflict: this.conflict }, () => {
                player.resolveRingEffects(this.conflict.conflictRing);
            });
        }
        return true;
    }
    
    claimRing() {
        if(this.conflict.cancelled) {
            return;
        }

        if(this.conflict.winner) {
            let ring = _.find(this.game.rings, ring => {
                return ring.element === this.conflict.conflictRing;
            });
            this.game.raiseEvent('onClaimRing', { player: this.conflict.winner, conflict: this.conflict }, () => ring.claimRing(this.conflict.winner));
        }
    }

    returnHome() {
        if(this.conflict.cancelled) {
            return;
        }

        this.game.raiseSimultaneousEvent(this.conflict.attackers.concat(this.conflict.defenders), {
            eventName: 'onParticipantsReturnHome',
            perCardEventName: 'OnReturnHome',
            perCardHandler: (params) => params.card.controller.bowCard(params.card), 
            params: { conflict: this.conflict }
        });
    }
    
    completeConflict() {
        if(this.conflict.cancelled) {
            return;
        }

        this.game.raiseEvent('onConflictFinished', { conflict: this.conflict });

        this.resetCards();
        if(!this.game.militaryConflictCompleted && (this.conflictType === 'military' || this.conflictTypeSwitched)) {
            this.game.militaryConflictCompleted = true;
        }
        if(!this.game.politicalConflictCompleted && (this.conflictType === 'political' || this.conflictTypeSwitched)) {
            this.game.politicalConflictCompleted = true;
        }

        this.conflict.finish();
    }

    onCardClicked(player, card) {
        return this.pipeline.handleCardClicked(player, card);
    }

    onRingClicked(player, ring) {
        return this.pipeline.handleRingClicked(player, ring);
    }

    onMenuCommand(player, arg, method) {
        return this.pipeline.handleMenuCommand(player, arg, method);
    }

    cancelStep() {
        this.pipeline.cancelStep();
    }

    queueStep(step) {
        this.pipeline.queueStep(step);
    }

    continue() {
        return this.conflict.cancelled || this.pipeline.continue();
    }
}

module.exports = ConflictFlow;
