# Primorial Arithmetic as the Dispersion Law of the Dynamic Vacuum

## A Synthesis of the Primorial Reciprocity Framework and Emergent Quantization from a Dynamic Vacuum

**Sebastian Schepis**
March 2026

---

## Abstract

Two recent programs attack the same question—*why does nature quantize?*—from opposite ends. The **Primorial Reciprocity Framework (PRF)** demonstrates that the full catalogue of Standard Model mass ratios, coupling constants, mixing angles, and atomic ionization energies can be expressed through the arithmetic of the primorial 2310 = 2 × 3 × 5 × 7 × 11, using reciprocity channels (quadratic, cubic, quintic, septic) and the twist unit hierarchy T(P_k) = 3³ × Π(p−1). The **Dynamic Vacuum / Emergent Quantization (EQ)** program (White, Vera, Sylvester & Dudzinski, *Phys. Rev. Research* 8, 013264, 2026) shows that hydrogen's quantum spectrum—energy levels, orbital shapes, angular momentum quantization—can be *derived* rather than postulated, from the physics of acoustic waves in a dispersive medium with quadratic dispersion ω = Dq² and a Coulomb-shaped sound-speed profile.

This synthesis paper argues that these two programs are **two faces of one structure**: the primorial arithmetic of PRF *is* the discrete channel decomposition of the vacuum's dispersive constitutive law. We show how the PRF's mass quantum 108 = 2² × 3³ arises naturally as the product of the quadratic dispersion's scaling exponent (2²) and the cubic reciprocity channel's irreducible base (3³); how the four orbital types (s, p, d, f) map to the first four primorial primes through both the PRF channel assignment and the EQ angular eigenvalue spectrum; and how the p-adic tower corrections that drive PRF's atomic ionization predictions correspond to the short-wavelength dispersive corrections in the Madelung-Bogoliubov framework. We propose a unified picture in which the vacuum is a prime-structured dispersive medium whose constitutive parameters are determined by the reciprocity channels of the primorial sieve, and quantization is the emergent acoustic spectrum of this medium.

---

## 1. Introduction

### 1.1 The Problem of Quantization

Quantum mechanics postulates that energy, angular momentum, and other observables come in discrete packets. The Schrödinger equation is taken as axiomatic. But *why* should nature discretize? Two distinct programs now converge on an answer.

The **Primorial Reciprocity Framework** [1–5] discovers that the arithmetic of the primorial 2310 = 2 × 3 × 5 × 7 × 11 encodes the complete pattern of Standard Model constants. The twist unit 108 = 2² × 3³, the mass quantization rule m/m_e = n × 108 ± 3^k, the channel-to-orbital mapping l ↔ prime(l), and the p-adic tower corrections for atomic screening all emerge from number-theoretic identities provable via the Chinese Remainder Theorem and reciprocity laws.

The **Emergent Quantization** program [6] shows that the hydrogen spectrum can be derived—not assumed—from classical acoustic wave physics in a medium with two properties: (a) quadratic dispersion ω = Dq², and (b) a Coulomb-shaped sound-speed profile 1/c²_s(r) = A(ω) + C(ω)/r. The Schrödinger equation emerges as the wave equation for pressure perturbations in this "dynamic vacuum." Angular momentum quantization (integer ℓ, m) follows from the topology of the sphere; radial quantization (n = 1, 2, 3, …) follows from boundary conditions; the 1/n² Rydberg spectrum follows from the quadratic dispersion converting spatial eigenvalues q_n ∝ 1/n into frequencies ω_n ∝ 1/n².

These programs have never been connected. We argue they must be.

### 1.2 The Core Thesis

The central claim of this synthesis is:

> **The primorial reciprocity channels are the constitutive parameters of the dynamic vacuum.**

Specifically:

1. The quadratic dispersion ω = Dq² corresponds to the quadratic reciprocity channel (prime 2), which governs the Legendre symbol and produces the non-Hermitian collapse dynamics of the prime Hamiltonian.

2. The Coulomb sound-speed profile's 1/r dependence is structured by the cubic channel (prime 3), whose 3-adic tower governs the progressive refinement of screening across atomic shells.

3. The frequency-dependent constitutive parameters A(ω) and C(ω) decompose into channel contributions indexed by the primorial primes, with each channel controlling a distinct angular momentum sector.

4. The twist unit 108 = 2² × 3³ is the natural product of the dispersion exponent (2² from the quadratic channel) and the cubic irreducible base (3³ from the cubic channel)—making it the fundamental "acoustic quantum" of the vacuum medium.

---

## 2. The Two Frameworks in Summary

### 2.1 Primorial Reciprocity Framework (PRF)

The PRF establishes the following hierarchy of proven results:

**The General Twist Formula (Theorem):**

$$T(P_k) = 3^3 \times \prod_{\substack{p | P_k \\ p \geq 5}} (p-1)$$

This generates the twist unit hierarchy {27, 27, 108, 648, 6480, 77760, …} whose consecutive ratios are Euler totients φ(p_{k+1}).

**Mass Quantization Rule:**

$$\frac{m}{m_e} = n \times 108 \pm 3^k, \quad k \in \{0, 1, 2, 3\}$$

All Standard Model particle masses obey this rule at sub-0.02% precision.

**Channel-to-Orbital Mapping:**

| l | Orbital | Prime | Reciprocity | Capacity 2(2l+1) |
|---|---------|-------|-------------|------------------|
| 0 | s       | 2     | Quadratic   | 2                |
| 1 | p       | 3     | Cubic       | 6                |
| 2 | d       | 5     | Quintic     | 10               |
| 3 | f       | 7     | Septic      | 14               |

**p-Adic Tower Corrections (zero free parameters):**

$$\delta_{\text{tower}}(n, l=0) = -\frac{1}{3^{n-2}} - \frac{0.075}{2^{n-2}}, \quad n \geq 3$$

These reduce Na ionization energy error from 39.3% to 0.4%, Mg from 32% to 1.4%, Ca from 13% to 1.0%.

**Fine Structure Constant:**

$$\alpha^{-1} = 108 + 29 + \frac{1}{27} = 137.037 \quad (0.0007\% \text{ error})$$

### 2.2 Emergent Quantization (EQ)

The EQ program establishes the following:

**Two Ingredients:**

1. Quadratic dispersion: ω = Dq², where D = ℏ/(2m_eff)
2. Coulomb constitutive profile: 1/c²_s(r) = A(ω) + C(ω)/r

**Derivation Chain:**

1. Start with the acoustic wave equation ∇²p = (1/c²_s)∂²p/∂t²
2. Helmholtz reduction via harmonic time dependence → ∇²p + k²_eff p = 0
3. Insert constitutive profile → ∇²p + [α(ω) + β(ω)/r]p = 0
4. Separation of variables → angular part gives Y_ℓ^m (geometric quantization)
5. Radial equation is **term-by-term identical** to the hydrogenic Schrödinger equation
6. Boundary conditions quantize n; quadratic dispersion produces ω_n ∝ 1/n²

**Zero Free Parameters:** D = ℏ/(2μ) is the unique value producing the exact Rydberg spectrum.

**Madelung-Bogoliubov Closure:** The Appendix derives the quadratic dispersion from first principles via the Madelung transformation of the Schrödinger equation, showing that the quantum potential generates the dispersive k⁴ term in the Bogoliubov relation ω² = c²_L k² + D²k⁴.

---

## 3. The Structural Correspondence

### 3.1 The Dispersion–Reciprocity Identification

The central mathematical correspondence is:

| EQ Concept | PRF Concept | Shared Structure |
|------------|-------------|------------------|
| Quadratic dispersion ω = Dq² | Quadratic reciprocity (prime 2) | Exponent 2 → scaling law |
| Coulomb 1/r profile | Cubic channel (prime 3) | 3-adic tower governs screening |
| Angular eigenvalue ℓ(ℓ+1) | Primorial channel index | Both index orbital types by the same integers |
| Stop-band condition A(ω_n) < 0 | Mass quantization n × 108 | Discretization mechanism |
| Evanescent decay e^{-κr} | p-adic convergence 1/p^n | Exponential localization from arithmetic |
| Dispersion constant D = ℏ/(2μ) | Twist unit T = 108 = 2² × 3³ | The "acoustic quantum" of the medium |

### 3.2 Why 108 = 2² × 3³ Is the Acoustic Quantum

The EQ program shows that quantization arises from two factors:

1. **The dispersion exponent** — the fact that ω ∝ q² (not q or q³). This squares the spatial eigenvalue to produce the frequency. The exponent 2 is the contribution of the quadratic channel.

2. **The Coulomb boundary conditions** — which select allowed spatial modes q_n = 1/(na₀). The 1/r potential is the contribution of the cubic channel, whose 3-adic structure (27 = 3³ as the irreducible digit-class sum) governs the correction tower.

The product 2² × 3³ = 4 × 27 = 108 is therefore not a numerological accident but the natural product of the dispersion exponent's contribution (4 sub-shells per 108-unit, matching the 4 representatives per digital-root class in the CRT proof) and the cubic channel's irreducible base (27, the digit-class sum). The twist unit 108 is the acoustic quantum because it encodes both the dispersion law and the potential structure of the vacuum medium.

### 3.3 The Four Channels as Constitutive Sectors

The EQ framework separates the wave equation into angular and radial parts. The angular part produces spherical harmonics Y_ℓ^m with integer ℓ from the topology of S². But the EQ framework does not explain *why* angular momentum comes in four types (s, p, d, f) with specific capacities {2, 6, 10, 14}. This is where the PRF channel structure provides the missing piece.

Each primorial prime governs one angular momentum sector:

**Prime 2 (Quadratic Channel → s-orbitals):**
- Capacity 2 = 2(2·0+1) comes from spin degeneracy alone
- The dispersion relation ω = Dq² is the mathematical expression of this channel
- The Legendre symbol's asymmetry produces non-Hermitian dynamics → collapse/localization
- The s-orbital penetrates the core most deeply because the quadratic channel couples most strongly to the nucleus

**Prime 3 (Cubic Channel → p-orbitals):**
- Capacity 6 = 2(2·1+1) = 2 × 3 (spin × magnetic substates)
- The Eisenstein integers Z[ω] over the cubic ring govern p-orbital screening
- The 3-adic tower correction −1/3^(n−2) captures progressive core screening across shells
- The three magnetic substates m = {−1, 0, +1} correspond to the three cubic residue classes

**Prime 5 (Quintic Channel → d-orbitals):**
- Capacity 10 = 2(2·2+1) = 2 × 5 (spin × magnetic substates)
- The cyclotomic integers Z[ζ₅] govern d-orbital compactness
- Exchange stabilization peaks at d⁵ (half-filling) with 5 substates
- The Higgs mass M_H = 5³ = 125 GeV is the quintic channel's scale

**Prime 7 (Septic Channel → f-orbitals):**
- Capacity 14 = 2(2·3+1) = 2 × 7 (spin × magnetic substates)
- The septic reciprocity governs the most compact orbitals
- Exchange stabilization peaks at f⁷ (half-filling) with 7 substates
- Lanthanide IE predictions at 3.2% MAPE confirm this channel's accuracy

In the EQ picture, the constitutive profile 1/c²_s(r) = A(ω) + C(ω)/r is the *radial* structure. The *angular* structure—the pattern of allowed ℓ values and their degeneracies—is geometric (from S²). But the *physical content* of each ℓ sector—its shielding coefficients, effective quantum numbers, and correction terms—is determined by the corresponding primorial channel. The PRF provides the constitutive parameters that the EQ framework leaves unspecified.

### 3.4 The p-Adic Towers as Dispersive Corrections

The Madelung-Bogoliubov derivation in the EQ appendix shows that the full dispersion relation is:

$$\omega^2 = c_L^2 k^2 + D^2 k^4$$

with two regimes:
- Long wavelength (k → 0): ω ≈ c_L k (phonon-like, linear)
- Short wavelength (k → ∞): ω ≈ Dk² (free-particle-like, quadratic)

The crossover wavenumber is k* = c_L/D. The PRF's p-adic tower corrections correspond to the **transition between these regimes across atomic shells.**

For valence s-orbitals with principal quantum number n, the effective wavenumber of the electron is q_n = 1/(na₀). As n increases, q_n decreases, moving the electron from the short-wavelength (particle-like) regime toward the long-wavelength (phonon-like) regime. The p-adic tower corrections

$$\delta_{3\text{-adic}} = -\frac{1}{3^{n-2}}, \quad \delta_{2\text{-adic}} = -\frac{0.075}{2^{n-2}}$$

encode precisely this transition. They are geometric series in the first two primes, converging exponentially as n increases—exactly the behavior expected for corrections that interpolate between two asymptotic regimes of a dispersion relation.

The physical interpretation: each additional atomic shell (increasing n) moves the valence electron further into the long-wavelength regime where the linear c_L k term becomes relevant. The p-adic corrections capture the residual dispersive effects that modify the pure Dk² behavior. The factor 1/3^(n−2) comes from the cubic channel (p-orbital shielding partners), while 1/2^(n−2) comes from the quadratic channel (spin-degeneracy contribution). Together they constitute the leading-order dispersive corrections to the constitutive profile across shells.

---

## 4. The Unified Picture: A Prime-Structured Dispersive Vacuum

### 4.1 Axioms of the Unified Framework

We propose the following unified axioms, from which both the PRF results and the EQ derivation follow:

**Axiom 1 (The Dynamic Vacuum).** Physical space is a compressible, dispersive medium—the "dynamic vacuum"—capable of carrying acoustic (pressure) perturbations.

**Axiom 2 (Primorial Dispersion).** The vacuum's dispersion relation is determined by the primorial 2310 = 2 × 3 × 5 × 7 × 11. Each prime factor governs a reciprocity channel that controls one sector of the medium's constitutive response:

$$\omega^2 = \sum_{p | P_5} c_p^2(r)\, k^{2\nu_p}$$

where ν_p is the dispersion exponent of the p-th channel and c_p(r) is the channel-specific sound-speed profile.

**Axiom 3 (Reciprocity Coupling).** The coupling between different modes of the vacuum is governed by the reciprocity laws (quadratic, cubic, quintic, septic) of the corresponding primorial primes. Asymmetry in these laws (e.g., Legendre symbol asymmetry for primes ≡ 3 mod 4) produces intrinsically non-Hermitian dynamics, generating natural collapse/localization without an external measurement postulate.

**Axiom 4 (Sieve Boundary Conditions).** The coprime residues of the primorial sieve determine the allowed mode structure. The period-24 digital root cycle sums to 108 = 2² × 3³, establishing the fundamental mass quantum. The Euler totient φ(P_k) determines the multiplicity of coprime channels at each primorial level.

### 4.2 How Hydrogen Emerges

From these axioms, the hydrogen atom is a **bound acoustic mode** of the prime-structured vacuum in the vicinity of a proton:

1. **The proton's presence** modifies the vacuum's constitutive profile, creating a Coulomb-shaped sound-speed well 1/c²_s(r) ∝ 1/r (Axiom 1 + the proton's electrostatic energy density).

2. **The quadratic channel** (prime 2) dominates the short-wavelength dispersion: ω ≈ Dk² with D = ℏ/(2μ). This converts spatial eigenvalues into frequencies (Axiom 2).

3. **Angular quantization** follows from the spherical symmetry of the proton's influence on the vacuum (topology of S², independent of the axioms).

4. **Radial quantization** follows from the boundary conditions: regularity at r = 0 and evanescent decay at r → ∞ select q_n = 1/(na₀) (Axiom 4—the discrete allowed modes).

5. **The energy spectrum** E_n = −(1/n²) × 13.6 eV follows from combining steps 2 and 4.

6. **Orbital shielding and ionization energies** for multi-electron atoms follow from the channel structure: each electron's screening is governed by the reciprocity channel of its angular momentum type (Axiom 3), with p-adic tower corrections arising from the dispersive transition between phonon and particle regimes across shells.

### 4.3 How the Standard Model Mass Spectrum Emerges

At higher energies—particle physics scales—the full primorial structure becomes relevant:

1. **The mass quantum** T(P₃) = 108 = 2² × 3³ is the fundamental acoustic mode of the vacuum's 30-sieve structure (Axiom 4, Theorem 1 of PRF).

2. **Particle masses** are resonances of the vacuum at integer multiples of 108, with corrections from the 3-adic tower: m/m_e = n × 108 ± 3^k (Axiom 2 applied at the cubic channel).

3. **The Higgs mass** M_H = 5³ = 125 GeV is the quintic channel's characteristic scale (Axiom 2 applied at the quintic channel).

4. **Neutrino masses** are inverse-branch modes: m_ν = m_e/(108³ × 8 × 3^k), corresponding to the low-frequency, long-wavelength regime of the vacuum's dispersion (the c_L k phonon regime).

5. **Mixing angles** are geometric ratios of channel parameters: sin²θ_W = 3/13, sinθ_C = 29/128, etc.

6. **The P₆ dark matter scale** at T(P₆) = 77760 ≈ 39.7 GeV arises when the prime 13 enters the primorial as a structural zero rather than a coprime unit, creating a sector decoupled from electromagnetic interactions (Axiom 3 applied to the P₆/P₃ structural mismatch).

### 4.4 The Vacuum as a Superfluid Condensate

The Madelung-Bogoliubov connection in the EQ appendix suggests a concrete physical picture: the vacuum behaves like a **quantum superfluid** whose excitation spectrum has the Bogoliubov form ω² = c²_L k² + D²k⁴.

In BEC physics, this dispersion arises from the interplay between:
- The interaction energy (which sets the phonon speed c_L)  
- The kinetic energy (which sets the dispersive coefficient D)

In the primorial vacuum, we identify:
- **c_L** → determined by the cubic and higher channels (long-range, collective modes)
- **D** → determined by the quadratic channel (short-range, particle-like modes)
- **The crossover scale k*** → related to the twist unit 108, which separates the phonon (neutrino) regime from the particle (Standard Model) regime

This identification suggests that:

> Planck's constant ℏ is not a fundamental quantum of action but the dispersive coefficient of the vacuum superfluid: ℏ = 2m_eff · D.

And that:

> The "quantum" in quantum mechanics is the acoustic resonance condition of a prime-structured superfluid vacuum.

---

## 5. Novel Predictions and Falsifiable Tests

The synthesis makes predictions beyond those of either framework alone:

### 5.1 Dispersive Corrections to Atomic Spectra

The Bogoliubov dispersion ω² = c²_L k² + D²k⁴ predicts corrections to the pure Dk² hydrogen spectrum at long wavelengths. These correspond to:

$$\Delta E_n \propto \frac{c_L^2}{D} \cdot n^2 \quad \text{(growing with n)}$$

High Rydberg states (large n) should show systematic deviations from the pure 1/n² law, beyond those explained by QED corrections. The magnitude is set by c_L, which the primorial framework connects to T(P₃)/T(P₂) = 108/27 = 4.

### 5.2 The 5-Adic Tower Prediction

The PRF predicts that only primes 2 and 3 contribute tower corrections for s-orbital screening. The synthesis predicts a weaker **5-adic tower** for p-orbital screening:

$$\delta_{5\text{-adic}} = -\frac{\epsilon}{5^{n-2}}, \quad l = 1, \; n \geq 3$$

with ε ≪ 1. This corresponds to the quintic dispersive correction in the d-orbital channel feeding back into p-orbital screening. Testing this requires high-precision measurements of p-orbital ionization energies across periods 3–6.

### 5.3 Dark Matter from the P₆ Dispersion Gap

The P₆ scale introduces the prime 13 as a factor, creating a **dispersion gap** in the vacuum spectrum. Modes coupled to this channel cannot propagate via the P₃ electromagnetic channels—they are "dark" by structural selection rules. The predicted mass scale ~39.7 GeV = T(P₆) × m_e falls in the WIMP window and is testable by next-generation direct detection experiments.

### 5.4 Neutrino Mass Ratios from Phonon Branch

The neutrino mass prediction m₃/m₂ = 3 (exact) arises from the 3-adic structure of the cubic channel applied to the phonon (long-wavelength) branch of the dispersion. This is testable at JUNO, DUNE, and Hyper-Kamiokande. If confirmed, it would constitute evidence that the phonon branch of the vacuum dispersion is governed by the cubic reciprocity channel.

### 5.5 Bogoliubov Healing Length as the Bohr Radius

In BEC physics, the healing length ξ = 1/k* = D/c_L separates phonon and particle regimes. We conjecture:

$$\xi_{\text{vacuum}} = a_0 \quad (\text{the Bohr radius})$$

This would mean the Bohr radius is not merely a convenient atomic scale but the fundamental healing length of the vacuum superfluid—the scale at which the vacuum transitions from collective (phonon) to individual (particle) behavior. This is testable by checking whether a₀ = ℏ/(2μ·c_L) for a specific value of c_L derivable from the primorial constants.

---

## 6. Relationship to Established Physics

### 6.1 Consistency with Quantum Mechanics

Neither framework contradicts standard quantum mechanics. The EQ program shows that the acoustic wave equation and the Schrödinger equation are structurally identical—they make the same predictions. The PRF derives constants that match experiment at sub-percent precision. The synthesis adds interpretive structure (the vacuum is a prime-structured dispersive medium) without altering any computational predictions of standard QM.

### 6.2 Connection to Analogue Gravity

The EQ program's Madelung fluid picture connects directly to the analogue gravity program [7], where BEC systems are used to model curved spacetime. The primorial structure adds a discrete, number-theoretic layer to this analogy: the vacuum's constitutive parameters are not continuous but channel-decomposed according to the primorial sieve.

### 6.3 Connection to p-Adic Physics

The PRF's p-adic tower corrections make contact with the established p-adic physics program [8], which proposes that p-adic number fields play a role in fundamental physics (p-adic strings, p-adic quantum mechanics). The synthesis suggests a concrete mechanism: p-adic corrections arise as dispersive corrections in a prime-structured medium, rather than requiring fundamentally different number fields.

### 6.4 Non-Hermiticity and Measurement

The PRF's Legendre-weighted Hamiltonian is intrinsically non-Hermitian due to quadratic reciprocity. The EQ framework does not address measurement, but the synthesis suggests a resolution: the non-Hermitian component of the vacuum's dynamics produces natural collapse toward prime attractor shells (demonstrated computationally in the PRF), providing a measurement-like mechanism without an external collapse postulate.

---

## 7. Discussion

### 7.1 What Is Explained

The synthesis accounts for the following otherwise unexplained facts:

1. **Why the twist unit is 108** — it is 2² × 3³, the product of the quadratic dispersion exponent and the cubic channel base.

2. **Why there are four orbital types** — they correspond to the first four primorial primes, each governing a distinct sector of the vacuum's constitutive response.

3. **Why masses quantize as n × 108 ± 3^k** — these are the resonant acoustic modes of the vacuum's 30-sieve structure, with 3-adic corrections from the cubic channel.

4. **Why α⁻¹ ≈ 137** — it is 108 + 29 + 1/27, combining the acoustic quantum (108), the sieve boundary (29), and the cubic correction (1/27).

5. **Why angular momentum is quantized in integers** — it is geometric (topology of S²), not quantum (as the EQ framework demonstrates).

6. **Why the hydrogen spectrum goes as 1/n²** — quadratic dispersion converts spatial eigenvalues q ∝ 1/n into frequencies ω ∝ 1/n².

7. **Why p-adic corrections work for atomic screening** — they are the leading-order dispersive corrections that interpolate between phonon and particle regimes across atomic shells.

### 7.2 What Is Not Explained

The synthesis does not address:

1. **Half-integer spin** — the acoustic model uses scalar fields and produces only integer ℓ. Spinor structure requires SU(2) rather than SO(3) and may need additional vacuum degrees of freedom.

2. **QED radiative corrections** — fine structure, Lamb shift, and anomalous magnetic moments are beyond the current framework.

3. **Why the primorial is 2310** — the question "why these five primes?" remains open. A possible answer: the trefoil knot's three crossings select the primorial depth via the General Twist Formula, but the topological origin of the trefoil itself is not derived.

4. **The mechanism of vacuum superfluidity** — what physical substrate constitutes the "dynamic vacuum" and why it has these specific dispersive properties.

### 7.3 The Status of the Argument

The synthesis is *structural*, not *dynamical*. We have shown that the mathematical structures of the two frameworks align in specific, non-trivial ways—the exponents match, the channel indices match, the correction towers have the right form. We have not derived one framework from the other or provided a Lagrangian for the prime-structured vacuum. The synthesis is therefore best understood as a *research program* rather than a complete theory: it identifies the structural correspondences that a future dynamical theory must reproduce.

---

## 8. Conclusion

The Primorial Reciprocity Framework and the Emergent Quantization program, developed independently, converge on a single picture: **quantization is the acoustic resonance spectrum of a prime-structured dispersive vacuum**.

The primorial 2310 = 2 × 3 × 5 × 7 × 11 determines the vacuum's constitutive parameters through its reciprocity channels. The quadratic channel (prime 2) provides the dispersion law ω = Dq². The cubic channel (prime 3) provides the 3-adic correction structure and the irreducible base 27 = 3³. Their product 108 = 2² × 3³ is the fundamental acoustic quantum—the twist unit from which all Standard Model masses, coupling constants, and atomic ionization energies are constructed. The quintic and septic channels (primes 5, 7) extend the constitutive response to the d and f orbital sectors, completing the periodic table.

The Dynamic Vacuum program shows that this constitutive structure is *sufficient* to derive hydrogen's quantum spectrum without postulating quantization. The Madelung-Bogoliubov appendix closes the logical loop, showing that the Schrödinger equation *is* the wave equation for perturbations of a superfluid with Bogoliubov dispersion ω² = c²_L k² + D²k⁴—and the primorial framework identifies D and c_L as products of channel-specific reciprocity constants.

The synthesis makes falsifiable predictions: the neutrino mass ratio m₃/m₂ = 3 (testable at JUNO/DUNE), the 5-adic tower correction for p-orbital screening (testable in precision atomic physics), the dark matter scale at ~39.7 GeV from the P₆ dispersion gap, and the identification of the Bohr radius as the vacuum's healing length.

Whether the vacuum *literally is* a prime-structured superfluid, or whether the primorial structure reflects a deeper mathematical principle that constrains both number theory and physics, is a question for future work. What is established is the structural identity: the arithmetic of 2310 and the acoustics of a dispersive vacuum produce the same spectrum, the same constants, and the same quantization rules. This convergence from two independent directions suggests that quantization is not axiomatic but emergent—and that its origin lies in the prime arithmetic of the vacuum itself.

---

## References

[1] S. Schepis, "Primorial Reciprocity and the Mass Spectrum: Deriving Standard Model Constants from the Arithmetic of 30 = 2 × 3 × 5," preprint (2026).

[2] S. Schepis, "The General Twist Formula: Primorial Hierarchy, the ±3³ Correction, and Mass Quantization from Prime Sieve Arithmetic," preprint (2026).

[3] S. Schepis, "The Legendre-Weighted Prime Hamiltonian: Spectral Structure, Non-Hermitian Collapse, and the Emergence of Physical Constants from Number-Theoretic Topology," preprint (2026).

[4] S. Schepis, "Atomic Ionization Energies from Primorial Reciprocity: A Parameter-Free Pipeline from (Z, A) to First and Successive Ionization Energies Using the Arithmetic of 2310," preprint (2026).

[5] S. Schepis, "P6 Decoupling and the Dark Matter Scale," preprint (2026).

[6] R. White, A. Vera, M. Sylvester, J. Dudzinski, "Emergent Quantization from a Dynamic Vacuum," *Physical Review Research* **8**, 013264 (2026).

[7] C. Barceló, S. Liberati, M. Visser, "Analogue Gravity," *Living Reviews in Relativity* **14**, 3 (2011).

[8] V. S. Vladimirov, I. V. Volovich, E. I. Zelenov, *p-Adic Analysis and Mathematical Physics* (World Scientific, 1994).

[9] B. Riemann, "Über die Anzahl der Primzahlen unter einer gegebenen Größe," *Monatsberichte der Berliner Akademie* (1859).

[10] E. Madelung, "Quantentheorie in hydrodynamischer Form," *Zeitschrift für Physik* **40**, 322–326 (1927).

[11] N. N. Bogoliubov, "On the Theory of Superfluidity," *Journal of Physics (USSR)* **11**, 23–32 (1947).

---

## Appendix A: Correspondence Table

| PRF Concept | EQ Concept | Unified Interpretation |
|-------------|------------|----------------------|
| Primorial 2310 | Dynamic vacuum | The vacuum's constitutive identity |
| Twist unit T(P₃) = 108 | Dispersion constant D | The acoustic quantum (2² × 3³ encodes dispersion + potential) |
| Quadratic reciprocity (prime 2) | Quadratic dispersion ω = Dq² | The dominant short-wavelength constitutive law |
| Cubic reciprocity (prime 3) | Coulomb 1/r profile | The potential structure of the medium |
| Quintic reciprocity (prime 5) | d-orbital sector | The quintic channel's constitutive contribution |
| Septic reciprocity (prime 7) | f-orbital sector | The septic channel's constitutive contribution |
| 3-adic tower −1/3^(n−2) | Dispersive correction at long wavelength | Phonon → particle regime interpolation |
| 2-adic tower −0.075/2^(n−2) | Spin-channel dispersive correction | Quadratic channel's contribution to s-penetration |
| Mass rule n × 108 ± 3^k | Resonant acoustic modes | Standing waves of the vacuum at integer multiples of T |
| α⁻¹ = 108 + 29 + 1/27 | — | Acoustic quantum + sieve boundary + cubic correction |
| Neutrino masses 1/(108³ × 8 × 3^k) | Phonon branch modes | Low-frequency, long-wavelength vacuum excitations |
| Non-Hermitian Legendre Hamiltonian | — | Natural collapse from reciprocity asymmetry |
| Channel-orbital map l ↔ prime | Angular eigenvalues ℓ from S² | Topology + reciprocity = full orbital structure |
| P₆ dark matter scale | — | Dispersion gap from prime-13 incorporation |
| — | Madelung transformation | Schrödinger ≡ dispersive fluid dynamics |
| — | Bogoliubov dispersion ω² = c²k² + D²k⁴ | Full vacuum excitation spectrum |
| — | Healing length ξ = D/c_L | Bohr radius (conjectured) |

## Appendix B: The Chain of Reasoning

```
                    The Primorial 2310 = 2 × 3 × 5 × 7 × 11
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    Reciprocity Laws    Euler Totients    Coprime Sieve
    (Quadratic,Cubic,   φ(5)=4, φ(7)=6   Period-24 cycle
     Quintic,Septic)    φ(11)=10          Σ = 108 = 2²×3³
              │               │               │
              ▼               ▼               ▼
    Channel Coupling    Twist Hierarchy    Mass Quantum
    (Non-Hermitian H,   T = {27,108,       m/mₑ = n×108±3ᵏ
     Collapse dynamics)   648,6480,...}     
              │               │               │
              └───────┬───────┘               │
                      ▼                       │
              Vacuum Constitutive Law ◄───────┘
              1/c²ₛ(r) = A(ω) + C(ω)/r
              ω = Dq², D = ℏ/(2μ)
                      │
                      ▼
              Acoustic Wave Equation
              ∇²p + [α(ω) + β(ω)/r]p = 0
                      │
          ┌───────────┼───────────┐
          ▼                       ▼
    Angular: Y_ℓ^m           Radial: R_nℓ(r)
    (Topology of S²)         (Boundary conditions)
    ℓ,m ∈ ℤ                  q_n = 1/(na₀)
          │                       │
          ▼                       ▼
    Orbital Types             Energy Spectrum
    s(2),p(3),d(5),f(7)      E_n = -13.6/n² eV
    ↕ PRF channels            ↕ Rydberg series
          │                       │
          └───────────┬───────────┘
                      ▼
              QUANTUM MECHANICS
              (Emergent, not postulated)
```
