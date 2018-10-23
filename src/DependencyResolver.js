import { flatten } from "./helpers";

export default class DependencyResolver {
    tree = {};
    resolvableSets = [];

    constructor(featuresToResolve: [string], getDependency, resolveDependencyChoices) {
        // Add the features we want to resolve to the tree root
        featuresToResolve.forEach(feature => this.tree[feature] = null);

        this.getDependency = getDependency;
        this.resolveDependencyChoices = resolveDependencyChoices;
    }

    resolveLeaf(treeBranch, fullTree) {
        if (!fullTree) fullTree = treeBranch;

        return Object.keys(treeBranch).reduce((result, subBranch) => {
            // SubBranch is not yet resolved. Do so now!
            if (treeBranch[subBranch] === null) {

                // Resolve the dependencies
                let dependency = this.getDependency(subBranch);
                if (!dependency) return false;
                treeBranch[subBranch] = {};

                if (dependency.depends !== undefined) {
                    for (let subDependency in dependency.depends) {
                        if (!dependency.depends.hasOwnProperty(subDependency)) continue;
                        subDependency = dependency.depends[subDependency];

                        // Ignore this if subDependency is already inserted somewhere else in the tree
                        if (DependencyResolver.flattenTreeIntoSet(fullTree).has(subDependency)) continue;

                        let choices = this.resolveDependencyChoices(subDependency);

                        if (choices.length > 1) {
                            // Insert all the choices
                            treeBranch[subBranch][subDependency] = choices.map(choice => choice.identifier);
                        } else if (choices.length < 1) {
                            // This branch won't lead anywhere
                            // TODO Instead of returning false send something that indicates what can't be resolved
                            return false;
                        } else {
                            // Initialize the leaf of the subBranch with the only choice
                            treeBranch[subBranch][choices[0].identifier] = null;
                        }
                    }
                }

                return result && this.resolveLeaf(treeBranch[subBranch], fullTree);
            } else if (!(treeBranch[subBranch] instanceof Array) && Object.keys(treeBranch[subBranch]).length > 0) {
                // Go further down the tree
                return result && this.resolveLeaf(treeBranch[subBranch], fullTree);
            }

            return result;
        }, true);
    }

    static getReferenceToFirstChoice(treeBranch, parentMod) {
        for (let subBranch in treeBranch) {
            if (!treeBranch.hasOwnProperty(subBranch)) continue;

            if (treeBranch[subBranch] instanceof Array) {
                return {
                    mod: parentMod,
                    feature: subBranch,
                    choices: treeBranch[subBranch],
                    select: choice => {
                        delete treeBranch[subBranch];
                        treeBranch[choice] = null;
                    }
                }
            } else {
                const result = DependencyResolver.getReferenceToFirstChoice(treeBranch[subBranch], subBranch);
                if (result instanceof Object) return result;
            }
        }
    }

    static insertFirstAvailableChoice(fullTree, treeBranch) {
        for (let subBranch in treeBranch) {
            if (!treeBranch.hasOwnProperty(subBranch)) continue;

            if (treeBranch[subBranch] instanceof Array) {
                // Return a set of full trees that have a choice selected
                const choices = treeBranch[subBranch];
                const choiceTrees = choices.map(choice => {
                    // Make a backup
                    let subBranchData = treeBranch[subBranch];
                    // Modify the tree
                    delete treeBranch[subBranch];
                    treeBranch[choice] = null;
                    // Create a copy
                    let treeCopy = JSON.parse(JSON.stringify(fullTree));
                    // Revert what we've done
                    treeBranch[subBranch] = subBranchData;
                    delete treeBranch[choice];
                    // Return the copy
                    return treeCopy;
                });
                treeBranch[subBranch] = choices;
                return choiceTrees;
            } else {
                const result = DependencyResolver.insertFirstAvailableChoice(fullTree, treeBranch[subBranch]);
                if (result instanceof Object) return result;
            }
        }

        return false;
    }

    static doesTreeContainChoice(treeBranch) {
        let result = false;
        for (let subBranch in treeBranch) {
            if (!treeBranch.hasOwnProperty(subBranch)) continue;

            if (treeBranch[subBranch] instanceof Array) {
                return true;
            } else {
                result = result || DependencyResolver.doesTreeContainChoice(treeBranch[subBranch]);
                if (result) return true;
            }
        }
        return result;
    }

    convertChoicesToTrees(tree) {
        if (!this.resolveLeaf(tree)) {
            console.log("Unable to resolve tree:");
            console.dir(tree, {depth: null, colors: true});
            return [];
        }

        if (DependencyResolver.doesTreeContainChoice(tree)) {
            // [Tree]
            let trees = DependencyResolver.insertFirstAvailableChoice(tree, tree);
            // [[Tree]]
            let choiceInlinedTrees = trees.map(tree => this.convertChoicesToTrees(tree));
            return flatten(choiceInlinedTrees);
        } else {
            return [tree];
        }
    }

    static flattenTreeIntoSet(tree) {
        let flattenTree = (set, tree) => {
            Object.keys(tree).forEach(dependency => {
                if (tree[dependency] instanceof Array) return;

                // Add all elements at the current level
                set.add(dependency);

                // Process subTrees
                if (tree[dependency] !== null) flattenTree(set, tree[dependency]);
            });
        };

        let set = new Set();
        flattenTree(set, tree);
        return set;
    }

    isSetConflicting(set) {
        for (let item of set) {
            // TODO Cache this.getDependency(item)
            let conflicts = this.getDependency(item).conflicts;
            if (conflicts instanceof Array) {
                for (let conflict in conflicts) {
                    if (!conflicts.hasOwnProperty(conflict)) continue;

                    // Check whether or not each other item in set conflicts
                    for (let otherItem of set) {
                        // Iterate over the set without item
                        if (otherItem === item) continue;

                        // If the other item equals the conflict bail out
                        if (otherItem === conflicts[conflict]) return true;

                        // If otherItem provides conflict bail out
                        const providedFeatures = this.getDependency(otherItem).provides;
                        if (providedFeatures.indexOf(conflicts[conflict]) > -1) return true;
                    }
                }
            }
        }
        return false;
    }

    isChoiceResolvable(choice) {
        return this.resolvableSets.reduce((acc, set) => acc || set.has(choice), false);
    }

    buildDependencyTrees() {
        // Recursively resolve the tree and build a tree for each combination of choices
        let allTrees = this.convertChoicesToTrees(this.tree);

        // Flatten every tree into a set of mods
        let allTreesFlattened = allTrees.map(DependencyResolver.flattenTreeIntoSet);

        // Throw out sets with conflicts in them
        this.resolvableSets = allTreesFlattened.filter(set => !this.isSetConflicting(set));
    }

    resolveNextChoice() {
        // Resolve the tree as far as possible
        this.resolveLeaf(this.tree);

        // Get the first available choice
        const choice = DependencyResolver.getReferenceToFirstChoice(this.tree);
        if (!choice) return;

        // Filter choice.choices by looking at this.resolvableSets
        const { choices, unresolvableChoices } = choice.choices.reduce((result, choice) => {
            if (this.isChoiceResolvable(choice)) result.choices.push(choice);
            else result.unresolvableChoices.push(choice);
            return result;
        }, { choices: [], unresolvableChoices: [] });

        choice.choices = choices;
        choice.unresolvableChoices = unresolvableChoices;

        // Additionally extend choice.select by filtering this.resolvableSets by the resulting tree.
        const originalFunction = choice.select;
        choice.select = choice => {
            originalFunction(choice);

            const currentSet = DependencyResolver.flattenTreeIntoSet(this.tree);
            this.resolvableSets = this.resolvableSets.filter(set => {
                return [...currentSet.keys()].reduce((result, queuedMod) => set.has(queuedMod) && result, true);
            });
        };

        return choice;
    }

    getPendingInstallSet() {
        if (this.resolvableSets.length > 0) return DependencyResolver.flattenTreeIntoSet(this.tree);
    }
};

