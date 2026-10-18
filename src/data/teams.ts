import type { ClubBase, Confederation } from '../engine/types';

// Função auxiliar para criar objetos de times (escudo: imagem pública do Transfermarkt; há um escudo gerado de reserva)
const t = (name: string, country: string, ovr: number, id: string, isElite = false): ClubBase => ({
  name, country, ovr, id, isElite,
  logo: `https://tmssl.akamaized.net/images/wappen/normquad/${id}.png`
});

export const eliteEurope: ClubBase[] = [
    t("Manchester City", "ENG", 93, "281", true), t("Real Madrid", "ESP", 92, "418", true),
    t("Bayern de Munique", "GER", 90, "27", true), t("Paris SG", "FRA", 89, "583", true),
    t("Arsenal", "ENG", 88, "11", true), t("Barcelona", "ESP", 87, "131", true),
    t("Liverpool", "ENG", 89, "31", true), t("Chelsea", "ENG", 85, "631", true),
    t("Inter de Milão", "ITA", 87, "46", true), t("Juventus", "ITA", 85, "506", true),
    t("Atlético de Madrid", "ESP", 86, "13", true), t("Borussia Dortmund", "GER", 85, "16", true),
    t("Napoli", "ITA", 85, "6195", true), t("Bayer Leverkusen", "GER", 86, "15", true),
    t("Manchester United", "ENG", 84, "985", true), t("AC Milan", "ITA", 84, "5", true)
];

// Restante dos clubes do mundo
export const restOfWorld: ClubBase[] = [
    // BRASIL (7)
    t("Palmeiras", "BRA", 83, "1023"), t("Flamengo", "BRA", 84, "614"), t("Fluminense", "BRA", 81, "2462"),
    t("Corinthians", "BRA", 80, "199"), t("Atlético Mineiro", "BRA", 82, "330"), t("Botafogo", "BRA", 80, "537"),
    t("Grêmio", "BRA", 81, "210"),
    // ARGENTINA (6)
    t("Boca Juniors", "ARG", 81, "189"), t("River Plate", "ARG", 82, "209"), t("Racing", "ARG", 78, "1444"),
    t("San Lorenzo", "ARG", 76, "1775"), t("Talleres", "ARG", 77, "3938"), t("Rosario Central", "ARG", 74, "1418"),
    // OUTROS SA (6)
    t("Peñarol", "URU", 76, "861"), t("Nacional", "URU", 75, "866"), t("Colo-Colo", "CHI", 75, "2433"),
    t("Univ. Católica", "CHI", 73, "3277"), t("Indep. Del Valle", "ECU", 77, "19309"), t("LDU", "ECU", 76, "9855"),
    // EUROPA SECUNDÁRIA (13)
    t("Benfica", "POR", 82, "294"), t("Porto", "POR", 81, "720"), t("Sporting", "POR", 81, "336"),
    t("Ajax", "NED", 80, "610"), t("Feyenoord", "NED", 79, "234"), t("Galatasaray", "TUR", 79, "141"),
    t("Roma", "ITA", 82, "12"), t("Tottenham", "ENG", 84, "148"), t("RB Leipzig", "GER", 83, "23826"),
    t("Olympique Marseille", "FRA", 80, "244"), t("Lyon", "FRA", 79, "1041"), t("Sevilla", "ESP", 80, "368"),
    t("Villarreal", "ESP", 81, "1050"),
    // AMÉRICA DO NORTE (7)
    t("Inter Miami", "USA", 78, "69261"), t("LA Galaxy", "USA", 74, "1061"), t("Seattle Sounders", "USA", 75, "9636"),
    t("LAFC", "USA", 76, "51828"), t("New York City FC", "USA", 73, "40058"), t("Columbus Crew", "USA", 74, "813"),
    t("Vancouver Whitecaps", "CAN", 72, "6321"),
    // ÁSIA / OCEANIA (9)
    t("Al-Hilal", "KSA", 81, "1114"), t("Al-Nassr", "KSA", 80, "18544"), t("Al-Ittihad", "KSA", 79, "8023"),
    t("Al-Ahli", "KSA", 78, "18487"), t("Al Ain FC", "UAE", 74, "2150"), t("WS Wanderers", "AUS", 70, "36100"),
    t("Sydney FC", "AUS", 71, "8054"), t("Melbourne City", "AUS", 69, "25580"), t("Wellington Phoenix", "NZL", 68, "8445"),
    // NOVOS CLUBES ADICIONADOS (15)
    t("Internacional", "BRA", 79, "6600"), t("São Paulo", "BRA", 79, "585"), t("Vasco da Gama", "BRA", 77, "978"),
    t("Cruzeiro", "BRA", 77, "609"), t("Athletico-PR", "BRA", 76, "679"),
    t("Urawa Red Diamonds", "JPN", 74, "828"), t("Kashima Antlers", "JPN", 73, "2241"), t("Vissel Kobe", "JPN", 74, "3958"),
    t("Monterrey", "MEX", 77, "2407"), t("Club América", "MEX", 77, "3631"), t("Tigres UANL", "MEX", 76, "7055"),
    t("Al Ahly", "EGY", 76, "7"), t("Wydad Casablanca", "MAR", 74, "6603"), t("Mamelodi Sundowns", "RSA", 74, "6356"),
    t("Auckland City", "NZL", 65, "11391")
];

export const ALL_TEAMS: ClubBase[] = [...eliteEurope, ...restOfWorld];
export const MAX_TOURNAMENT_TEAMS = 64;
export const MAX_USER_TEAMS = 8;
export const CONFS: Confederation[] = ['UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC'];

const EUROPE = ['ENG', 'ESP', 'GER', 'FRA', 'ITA', 'POR', 'NED', 'TUR'];
const SOUTH_AMERICA = ['BRA', 'ARG', 'URU', 'CHI', 'ECU'];
const NORTH_AMERICA = ['USA', 'CAN', 'MEX'];
const ASIA = ['KSA', 'UAE', 'JPN', 'AUS']; // Austrália está na AFC desde 2006
const AFRICA = ['EGY', 'MAR', 'RSA'];
const OCEANIA = ['NZL'];

export function getContinentByCountry(country: string): Confederation {
  if (EUROPE.includes(country)) return 'UEFA';
  if (SOUTH_AMERICA.includes(country)) return 'CONMEBOL';
  if (NORTH_AMERICA.includes(country)) return 'CONCACAF';
  if (ASIA.includes(country)) return 'AFC';
  if (AFRICA.includes(country)) return 'CAF';
  if (OCEANIA.includes(country)) return 'OFC';
  return 'UEFA';
}

export const COUNTRY_NAMES: Record<string, string> = {
    ENG: 'Inglaterra England', ESP: 'Espanha Spain', GER: 'Alemanha Germany', FRA: 'França France', ITA: 'Itália Italy',
    POR: 'Portugal', NED: 'Holanda Países Baixos Netherlands', TUR: 'Turquia Turkey', BRA: 'Brasil Brazil', ARG: 'Argentina',
    URU: 'Uruguai Uruguay', CHI: 'Chile', ECU: 'Equador Ecuador', USA: 'Estados Unidos EUA USA', CAN: 'Canadá Canada',
    MEX: 'México Mexico', KSA: 'Arábia Saudita Saudi Arabia', UAE: 'Emirados Árabes UAE', JPN: 'Japão Japan',
    AUS: 'Austrália Australia', NZL: 'Nova Zelândia New Zealand', EGY: 'Egito Egypt', MAR: 'Marrocos Morocco', RSA: 'África do Sul South Africa'
};
