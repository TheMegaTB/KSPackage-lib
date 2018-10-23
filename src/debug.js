import KSPackage from "./";
import {Version} from "./Version";
import KSPInstallation from "./Installation";

let kspackage = new KSPackage();

kspackage.kspVersion = new Version('1.4.5');

kspackage.repository.fetch().then(() => {
    console.log("Mods compatible with", kspackage.kspVersion.original, kspackage.repository._compatibleMods.length);

    const mod = kspackage.getMod("AstronomersVisualPack");
    const installation = new KSPInstallation(process.env.HOME + '/Downloads/KSP', kspackage.kspVersion);

    console.log(installation.pathForModVersion(mod));

    installation.downloadModVersion(mod).then(() => {
        console.log('download done');
    });
    // doStuff().then(() => console.log("cya"));
});

function waitForInput() {
    return new Promise(resolve => {
        process.stdin.resume();

        process.stdin.once('data', function (data) {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    })
}

async function doStuff() {
    const resolver = kspackage.getResolverForInstallationOf(["AstronomersVisualPack"]);
    console.log("Building dependency trees ...");
    resolver.buildDependencyTrees();
    console.log(`Built ${resolver.resolvableSets.length} dependency trees.`);

    let choice = resolver.resolveNextChoice();
    while (choice) {
        console.log(`Choices to satisfy feature '${choice.feature}' for mod '${choice.mod}':`);
        choice.choices.forEach((choice, id) => console.log(id, choice));

        const selected = await waitForInput();

        choice.select(choice.choices[selected]);
        choice = resolver.resolveNextChoice();
    }

    console.log(resolver.getPendingInstallSet());
}

// const deps = [
//     {
//         identifier: "a",
//         depends: ["z", "f"]
//     },
//     {
//         identifier: "x",
//         provides: ["z"],
//         conflicts: ["u", "v"]
//     },
//     {
//         identifier: "y",
//         provides: ["z"],
//         depends: ["j"]
//     },
//     { identifier: "i", provides: ["j"] },
//     { identifier: "r", provides: ["j"] },
//     // This should get nuked since 'o' doesn't exist
//     { identifier: "k", provides: ["j"], depends: ["o"] },
//
//     {
//         identifier: "b",
//         depends: ["g"]
//     },
//     {
//         identifier: "u",
//         provides: ["g"],
//         conflicts: ["x"]
//     },
//     {
//         identifier: "v",
//         provides: ["g"],
//         conflicts: ["x"]
//     },
//
//     {
//         identifier: "c",
//         depends: ["d", "e"]
//     },
//     { identifier: "e" },
//     { identifier: "d", depends: ["f"] },
//     { identifier: "f" }
// ];
//
// const resolveDependencyChoices = dependencyIdentifier => {
//     return deps.filter(x =>
//         x.identifier === dependencyIdentifier
//         || (x.provides !== undefined && x.provides.indexOf(dependencyIdentifier) > -1)
//     );
// };
//
// const getDependency = dependencyIdentifier => {
//     return deps.find(x => x.identifier === dependencyIdentifier);
// };
//
// const depRes = new DependencyResolver(["a", "b", "c"], getDependency, resolveDependencyChoices);
// depRes.buildDependencyTrees();
//
// let choice = depRes.resolveNextChoice();
// while (choice !== undefined) {
//     // TODO Ask the user right here
//     choice.select(choice.choices[0]);
//     choice = depRes.resolveNextChoice();
// }
//
// console.log(DependencyResolver.flattenTreeIntoSet(depRes.tree));
// console.dir(tree, {depth: null, colors: true});